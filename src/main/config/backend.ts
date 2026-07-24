const FP_DEV_BACKEND_BASE_URL =
    "http://127.0.0.1:3000/api/ferie-permessi";
const FP_SERVER_BACKEND_BASE_URL =
    "http://192.168.1.240:3000/api/ferie-permessi";

function resolveFpBackendBaseUrl(
    env: NodeJS.ProcessEnv = process.env,
) {
    const explicitUrl = String(env.AYPI_FP_BACKEND_URL || "").trim();
    if (explicitUrl) return explicitUrl;

    const isDevelopment = env.AYPI_DEV === "1";
    const usesNetworkPreview = env.AYPI_BLUEARCHIVE_PREVIEW === "1";
    return isDevelopment && !usesNetworkPreview
        ? FP_DEV_BACKEND_BASE_URL
        : FP_SERVER_BACKEND_BASE_URL;
}

export {
    FP_DEV_BACKEND_BASE_URL,
    FP_SERVER_BACKEND_BASE_URL,
    resolveFpBackendBaseUrl,
};
