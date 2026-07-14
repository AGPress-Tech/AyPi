import path from "path";
import { backendConfig } from "../../config";
import { logger } from "../logging/logger";
import { ensureDir } from "./backups";

export function normalizeAgpressLayout() {
    const baseDir = backendConfig.modules.feriePermessi.baseDir;
    const generalDir = backendConfig.modules.feriePermessi.generalDir;
    const generalDataDir = path.join(generalDir, "data");
    const purchasingDir = backendConfig.modules.productManager.dir;
    const transferDir = backendConfig.modules.transferAttrezzaggio.dir;
    const haasDir = backendConfig.modules.haasAttrezzaggio.dir;

    [
        baseDir,
        generalDir,
        generalDataDir,
        backendConfig.logging.dir,
        purchasingDir,
        path.join(purchasingDir, "products"),
        transferDir,
        path.join(transferDir, "_attachments"),
        haasDir,
        path.join(haasDir, "_attachments"),
    ].forEach((dirPath) => ensureDir(dirPath));

    logger.info("AGPRESS layout ensured", {
        event: "agpress_layout_ensured",
        category: "storage",
        module: "core",
        baseDir,
        generalDataDir,
    });
}
