// CpBridge — a tiny HTTP dispatcher that lets the containerised webapp drive the
// host-installed CyberArk Credential Provider. The container cannot load the CP's
// native SDK, so it POSTs a scenario here; the bridge runs the matching Java
// caller as a SUBPROCESS (so each scenario's calling application has its own
// identity/hash) and relays the caller's one-line JSON back verbatim.
//
// It binds the host interface reachable from the pod (host.minikube.internal) and
// holds the CP object coordinates in its own environment, so no Safe/Object names
// travel from the cluster. Only the JDK and the Credential Provider are required
// on the host — no extra runtime.
//
// Scenario -> caller mapping:
//   authorized   -> registered jar, authorized Safe/Object   -> success
//   invalid-hash -> UNregistered jar (rogue), same Safe/Object -> authn deny
//   denied       -> registered jar, a Safe it may NOT read     -> authz deny
//   dual         -> registered jar, dual-account query         -> active account
//
// Config (environment):
//   CP_BRIDGE_ADDR     listen host:port           (default 0.0.0.0:8890)
//   CP_APP_ID          the CP Application id       (required to be useful)
//   CP_SAFE, CP_OBJECT, CP_FOLDER                  (authorized; folder default Root)
//   CP_DENIED_SAFE, CP_DENIED_OBJECT               (scenario 3)
//   CP_DUAL_QUERY, CP_DUAL_VIRTUAL                 (scenario 4)
//   CP_SDK_JAR         JavaPasswordSDK.jar         (default /opt/CARKaim/sdk/JavaPasswordSDK.jar)
//   CP_SDK_LIBDIR      dir with libjavapasswordsdk.so (default: dir of CP_SDK_JAR)
//   CP_CALLER_JAR      registered caller jar       (default /opt/swa-cp/cp-caller.jar)
//   CP_ROGUE_JAR       unregistered caller jar     (default /opt/swa-cp/rogue/cp-caller.jar)
//   JAVA_BIN           java executable             (default java)

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class CpBridge {

    private static final long CALLER_TIMEOUT_SECONDS = 20;

    public static void main(String[] args) throws IOException {
        String addr = env("CP_BRIDGE_ADDR", "0.0.0.0:8890");
        String[] hp = addr.split(":", 2);
        String host = hp[0].isEmpty() ? "0.0.0.0" : hp[0];
        int port = hp.length > 1 ? Integer.parseInt(hp[1]) : 8890;

        HttpServer server = HttpServer.create(new InetSocketAddress(host, port), 0);
        server.createContext("/cp", CpBridge::handleCp);
        server.createContext("/healthz", ex -> respond(ex, 200, "{\"status\":\"ok\"}"));
        server.setExecutor(Executors.newFixedThreadPool(4));
        System.out.println("cp-bridge listening on " + host + ":" + port
                + " app=" + env("CP_APP_ID", "(unset)"));
        server.start();
    }

    private static void handleCp(HttpExchange ex) throws IOException {
        try {
            if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
                respond(ex, 405, "{\"ok\":false,\"error\":\"use POST\"}");
                return;
            }
            String scenario = queryParam(ex.getRequestURI().getRawQuery(), "scenario");
            List<String> cmd = buildCommand(scenario);
            if (cmd == null) {
                respond(ex, 400, "{\"ok\":false,\"error\":\"unknown scenario: " + escape(scenario) + "\"}");
                return;
            }
            String json = runCaller(cmd);
            respond(ex, 200, json);
        } catch (Exception e) {
            respond(ex, 200, "{\"ok\":false,\"error\":\"cp-bridge: " + escape(oneLine(e.toString())) + "\"}");
        }
    }

    // buildCommand maps a scenario to the java invocation for the right caller jar
    // + CP coordinates. Returns null for an unknown scenario.
    private static List<String> buildCommand(String scenario) {
        if (scenario == null) {
            return null;
        }
        String sdkJar = env("CP_SDK_JAR", "/opt/CARKaim/sdk/JavaPasswordSDK.jar");
        String libDir = env("CP_SDK_LIBDIR", parentDir(sdkJar));
        String callerJar = env("CP_CALLER_JAR", "/opt/swa-cp/cp-caller.jar");
        String rogueJar = env("CP_ROGUE_JAR", "/opt/swa-cp/rogue/cp-caller.jar");
        String appID = env("CP_APP_ID", "");
        String folder = env("CP_FOLDER", "Root");

        String jar;
        List<String> callerArgs = new ArrayList<>();
        callerArgs.add("--appid");
        callerArgs.add(appID);

        switch (scenario) {
            case "authorized":
                jar = callerJar;
                addSafeObject(callerArgs, env("CP_SAFE", ""), env("CP_OBJECT", ""), folder);
                break;
            case "invalid-hash":
                // Same request as authorized, but from the UNregistered jar: the CP
                // rejects the calling application's hash/path.
                jar = rogueJar;
                addSafeObject(callerArgs, env("CP_SAFE", ""), env("CP_OBJECT", ""), folder);
                break;
            case "denied":
                jar = callerJar;
                addSafeObject(callerArgs, env("CP_DENIED_SAFE", ""), env("CP_DENIED_OBJECT", ""), folder);
                break;
            case "dual":
                jar = callerJar;
                callerArgs.add("--query");
                callerArgs.add(env("CP_DUAL_QUERY", ""));
                String virtual = env("CP_DUAL_VIRTUAL", "");
                if (!virtual.isEmpty()) {
                    callerArgs.add("--virtual");
                    callerArgs.add(virtual);
                }
                break;
            default:
                return null;
        }

        List<String> cmd = new ArrayList<>();
        cmd.add(env("JAVA_BIN", "java"));
        cmd.add("-Djava.library.path=" + libDir);
        cmd.add("-cp");
        cmd.add(sdkJar + ":" + jar);
        cmd.add("CpCaller");
        cmd.addAll(callerArgs);
        return cmd;
    }

    private static void addSafeObject(List<String> args, String safe, String object, String folder) {
        args.add("--safe");
        args.add(safe);
        args.add("--object");
        args.add(object);
        args.add("--folder");
        args.add(folder);
    }

    // runCaller executes the caller and returns its stdout (expected: one JSON
    // line). Non-JSON output or a timeout is wrapped as an error object.
    private static String runCaller(List<String> cmd) {
        try {
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(false);
            Process p = pb.start();
            String stdout = readAll(p.getInputStream());
            boolean done = p.waitFor(CALLER_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (!done) {
                p.destroyForcibly();
                return "{\"ok\":false,\"error\":\"cp caller timed out\"}";
            }
            String trimmed = stdout.trim();
            if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                return trimmed;
            }
            String stderr = readAll(p.getErrorStream());
            String detail = trimmed.isEmpty() ? stderr : trimmed;
            return "{\"ok\":false,\"error\":\"cp caller produced no JSON: " + escape(oneLine(detail)) + "\"}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"cp caller failed: " + escape(oneLine(e.toString())) + "\"}";
        }
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) != -1) {
            bos.write(buf, 0, n);
        }
        return new String(bos.toByteArray(), StandardCharsets.UTF_8);
    }

    private static void respond(HttpExchange ex, int status, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json");
        ex.sendResponseHeaders(status, b.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(b);
        }
    }

    private static String queryParam(String rawQuery, String key) {
        if (rawQuery == null) {
            return null;
        }
        for (String pair : rawQuery.split("&")) {
            int i = pair.indexOf('=');
            if (i > 0 && pair.substring(0, i).equals(key)) {
                return urlDecode(pair.substring(i + 1));
            }
        }
        return null;
    }

    private static String urlDecode(String s) {
        try {
            return java.net.URLDecoder.decode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    private static String parentDir(String path) {
        int i = path.lastIndexOf('/');
        return i > 0 ? path.substring(0, i) : ".";
    }

    private static String env(String key, String def) {
        String v = System.getenv(key);
        return (v == null || v.isEmpty()) ? def : v;
    }

    private static String oneLine(String s) {
        if (s == null) {
            return "";
        }
        String t = s.replaceAll("\\s+", " ").trim();
        return t.length() > 300 ? t.substring(0, 300) + "…" : t;
    }

    private static String escape(String s) {
        if (s == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.toString();
    }

    private CpBridge() {
    }
}
