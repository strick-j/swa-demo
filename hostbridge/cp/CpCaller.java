// CpCaller — the application whose identity (hash / path / OS user) the CyberArk
// Credential Provider authenticates. It retrieves ONE account via the local
// JavaPasswordSDK and prints a single line of JSON on stdout. It never prints the
// raw secret: it emits only the secret's length and SHA-256 so the container-side
// retriever can render an identical masked proof without the value crossing the
// bridge.
//
// Two builds of this exact source ship: cp-caller.jar (its hash is registered on
// the CP Application) and cp-rogue.jar (a different file at a different path,
// deliberately NOT registered) — that difference is what the "invalid hash"
// scenario demonstrates.
//
// Usage:
//   java -cp javapasswordsdk.jar:cp-caller.jar CpCaller \
//        --appid <AppID> --safe <Safe> --object <Object> [--folder Root]
//   java -cp javapasswordsdk.jar:cp-caller.jar CpCaller \
//        --appid <AppID> --query "Safe=<s>;Folder=Root;Object=<o>" [--virtual <name>]
//
// Build against the SDK jar shipped with the Credential Provider, typically
//   /opt/CARKaim/sdk/javapasswordsdk.jar

import javapasswordsdk.CyberArkGetPassword;
import javapasswordsdk.PSDKPassword;
import javapasswordsdk.PSDKPasswordRequest;
import javapasswordsdk.PasswordSDK;
import javapasswordsdk.PasswordQueryFormat;
import javapasswordsdk.exceptions.PSDKException;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class CpCaller {

    public static void main(String[] args) {
        Map<String, String> a = parseArgs(args);
        Map<String, String> out = new HashMap<>();
        out.put("app_id", a.getOrDefault("appid", ""));
        out.put("safe", a.getOrDefault("safe", ""));
        out.put("os_user", System.getProperty("user.name", ""));
        out.put("caller_path", callerPath());
        out.put("app_hash", callerFingerprint());
        // Query display: either the explicit query, or Object=<object>.
        String queryDisplay = a.containsKey("query")
                ? a.get("query")
                : (a.containsKey("object") ? "Object=" + a.get("object") : "");
        out.put("query", queryDisplay);

        try {
            PSDKPasswordRequest req = new PSDKPasswordRequest();
            req.setAppID(require(a, "appid"));
            if (a.containsKey("query")) {
                req.setQuery(a.get("query"));
                req.setQueryFormat(PasswordQueryFormat.EXACT);
            } else {
                req.setSafe(require(a, "safe"));
                req.setFolder(a.getOrDefault("folder", "Root"));
                req.setObject(require(a, "object"));
            }

            PSDKPassword pw = fetch(req);

            String secret = pw.getContent();
            byte[] raw = secret == null ? new byte[0] : secret.getBytes(StandardCharsets.UTF_8);
            out.put("account", nullToEmpty(pw.getUserName()));
            out.put("address", nullToEmpty(pw.getAddress()));
            out.put("content_len", Integer.toString(raw.length));
            out.put("content_sha256", sha256Hex(raw));
            // A short leading preview so an operator can match it by eye against the
            // Vault (and watch it change on rotation). The rest stays on the host.
            out.put("content_prefix", preview(secret));
            // For a dual-account query the CP returns the ACTIVE account; surface the
            // fronting virtual username (passed in) and the resolved active account.
            if (a.containsKey("virtual")) {
                out.put("virtual_username", a.get("virtual"));
                out.put("dual_active", nullToEmpty(pw.getUserName()) + " (active)");
            }
            out.put("ok", "true");
        } catch (PSDKException e) {
            // This SDK's PSDKException exposes no getErrorCode(); the CyberArk code
            // (e.g. APPAP008E) is in the message text — extract it for the UI.
            String msg = e.getMessage();
            if (msg == null || msg.isEmpty()) {
                msg = e.toString();
            }
            out.put("ok", "false");
            out.put("error_code", errorCode(msg));
            out.put("error", oneLine(msg));
        } catch (Throwable t) {
            out.put("ok", "false");
            out.put("error", oneLine(t.toString()));
        }

        System.out.println(toJSON(out));
        // A denial is an EXPECTED demo outcome, not a process failure — exit 0 so
        // the bridge always relays the JSON rather than treating it as a crash.
        System.exit(0);
    }

    // fetch is the single method that requests a credential. Annotating it with
    // @CyberArkGetPassword lets JavaAIMGetAppInfo compute the hash for exactly this
    // executable (with -OnlyExecutablesWithAIMAnnotation=yes), and it is the hash
    // the Credential Provider verifies at runtime — so what you register matches
    // what is checked.
    @CyberArkGetPassword
    private static PSDKPassword fetch(PSDKPasswordRequest req) throws PSDKException {
        return PasswordSDK.getPassword(req);
    }

    private static Map<String, String> parseArgs(String[] args) {
        Map<String, String> m = new HashMap<>();
        for (int i = 0; i + 1 < args.length; i += 2) {
            String k = args[i];
            if (k.startsWith("--")) {
                m.put(k.substring(2), args[i + 1]);
            }
        }
        return m;
    }

    private static String require(Map<String, String> a, String k) {
        String v = a.get(k);
        if (v == null || v.isEmpty()) {
            throw new IllegalArgumentException("missing required --" + k);
        }
        return v;
    }

    // callerPath is the location of THIS jar — the application the CP measures.
    private static String callerPath() {
        try {
            return new File(CpCaller.class.getProtectionDomain()
                    .getCodeSource().getLocation().toURI()).getAbsolutePath();
        } catch (Exception e) {
            return "";
        }
    }

    // callerFingerprint is a short SHA-256 of this jar file. It is illustrative —
    // it visualizes that a different jar has a different fingerprint. The CP's own
    // application-hash uses CyberArk's algorithm; this is only for display.
    private static String callerFingerprint() {
        try {
            File self = new File(CpCaller.class.getProtectionDomain()
                    .getCodeSource().getLocation().toURI());
            if (!self.isFile()) {
                return "";
            }
            String hex = sha256Hex(Files.readAllBytes(self.toPath()));
            return hex.length() >= 6 ? hex.substring(0, 6) : hex;
        } catch (Exception e) {
            return "";
        }
    }

    private static String sha256Hex(byte[] b) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(b);
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte x : d) {
                sb.append(Character.forDigit((x >> 4) & 0xF, 16));
                sb.append(Character.forDigit(x & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    // preview returns the first few characters of the secret (fewer if shorter).
    // Keep this in sync with retrieve.PreviewLen on the Go side.
    private static final int PREVIEW_LEN = 6;

    private static String preview(String secret) {
        if (secret == null || secret.isEmpty()) {
            return "";
        }
        return secret.length() <= PREVIEW_LEN ? secret : secret.substring(0, PREVIEW_LEN);
    }

    // errorCode pulls a CyberArk error code (e.g. APPAP008E, CASVL010E) out of a
    // PSDK exception message; the SDK surfaces it only in the message text.
    private static final Pattern CODE = Pattern.compile("[A-Z]{3,7}[0-9]{2,4}[A-Z]");

    private static String errorCode(String msg) {
        if (msg == null) {
            return "";
        }
        Matcher m = CODE.matcher(msg);
        return m.find() ? m.group() : "";
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }

    private static String oneLine(String s) {
        if (s == null) {
            return "";
        }
        String t = s.replaceAll("\\s+", " ").trim();
        return t.length() > 300 ? t.substring(0, 300) + "…" : t;
    }

    // toJSON renders a flat string map, quoting content_len as a bare number.
    private static String toJSON(Map<String, String> m) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, String> e : m.entrySet()) {
            if (!first) {
                sb.append(',');
            }
            first = false;
            sb.append('"').append(e.getKey()).append("\":");
            if (e.getKey().equals("content_len") || e.getKey().equals("ok")) {
                sb.append(e.getValue().isEmpty() ? "null" : e.getValue());
            } else {
                sb.append('"').append(escape(e.getValue())).append('"');
            }
        }
        return sb.append('}').toString();
    }

    private static String escape(String s) {
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

    private CpCaller() {
    }
}
