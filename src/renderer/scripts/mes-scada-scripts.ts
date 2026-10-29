import { mountForgeLanding } from "./forge/landing";
require("./shared/dev-guards");
require("../modules/utils").initCommonUI();
document.documentElement.dataset.forgeTheme = "standard";
mountForgeLanding(document.getElementById("forge-landing-root")!, "standard");
