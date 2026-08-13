import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(here, "..");
export const WEB_DIR = join(ROOT, "web");
export const CORE_DIR = join(ROOT, "core");

// Tudo que é dado de instância mora em data/, que fica fora do controle de
// versão. É a fronteira entre o que se publica e o que é de quem usa.
export const DATA_DIR = process.env.TDAH_DATA_DIR
  ? resolve(process.env.TDAH_DATA_DIR)
  : join(ROOT, "data");

export const DB_FILE = join(DATA_DIR, "tdah-logus.db");
export const UPLOAD_DIR = join(DATA_DIR, "uploads");
