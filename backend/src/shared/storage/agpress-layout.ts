import fs from "fs";
import path from "path";
import { backendConfig } from "../../config";
import { logger } from "../logging/logger";
import { ensureDir } from "./backups";

function moveFileIfPresent(sourcePath: string, targetPath: string) {
    try {
        if (!fs.existsSync(sourcePath) || sourcePath === targetPath) return;
        ensureDir(path.dirname(targetPath));
        if (fs.existsSync(targetPath)) {
            fs.rmSync(sourcePath, { force: true });
            return;
        }
        fs.renameSync(sourcePath, targetPath);
    } catch (error) {
        logger.warn("AGPRESS move skipped", {
            event: "agpress_move_skipped",
            category: "storage",
            sourcePath,
            targetPath,
            detail: error instanceof Error ? error.message : String(error),
        });
    }
}

function removePathIfPresent(targetPath: string) {
    try {
        if (!fs.existsSync(targetPath)) return;
        fs.rmSync(targetPath, { recursive: true, force: true });
    } catch (error) {
        logger.warn("AGPRESS cleanup skipped", {
            event: "agpress_cleanup_skipped",
            category: "storage",
            targetPath,
            detail: error instanceof Error ? error.message : String(error),
        });
    }
}

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

    moveFileIfPresent(
        path.join(baseDir, "otp-mail.json"),
        path.join(generalDataDir, "otp-mail.json"),
    );
    moveFileIfPresent(
        path.join(generalDir, "otp-mail.json"),
        path.join(generalDataDir, "otp-mail.json"),
    );
    moveFileIfPresent(
        path.join(generalDir, "gitflow.json"),
        path.join(generalDataDir, "gitflow.json"),
    );
    moveFileIfPresent(
        path.join(purchasingDir, "session.json"),
        path.join(generalDataDir, "session.json"),
    );

    [
        path.join(baseDir, "AyPi Forms"),
        path.join(baseDir, "AyPi Gantt"),
        path.join(baseDir, "AyPi HR"),
        path.join(generalDir, "git-stats.json"),
    ].forEach((targetPath) => removePathIfPresent(targetPath));

    logger.info("AGPRESS layout normalized", {
        event: "agpress_layout_normalized",
        category: "storage",
        module: "core",
        baseDir,
        generalDataDir,
    });
}
