// eslint-disable-next-line import/no-extraneous-dependencies -- release-time script, tar is a root devDependency
import * as tar from "tar";

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Combine the per-package tarballs produced by `pnpm pack` into a single
 * `maci-protocol-extended` tarball. The original packages are bundled under
 * node_modules/@maci-protocol and every entry point is re-exported as a subpath,
 * e.g. `maci-protocol-extended/core` or `maci-protocol-extended/contracts/typechain-types`.
 *
 * Usage: ts-node packExtended.ts <dir with pnpm pack tarballs> <output dir>
 */

const NAME = "maci-protocol-extended";
const PACKAGES = ["crypto", "domainobjs", "core", "contracts", "sdk"];
const SCOPE = "@maci-protocol";

type ExportTarget = string | { types?: string; default: string };

interface IPackageJson {
  name: string;
  version: string;
  main?: string;
  types?: string;
  exports?: Record<string, ExportTarget>;
  dependencies?: Record<string, string>;
}

interface IEntryPoint {
  subpath: string;
  jsFile: string;
}

const readPackageJson = (dir: string): IPackageJson =>
  JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as IPackageJson;

const findTarball = (dir: string, pkg: string): string => {
  const pattern = new RegExp(`^maci-protocol-${pkg}-\\d.*\\.tgz$`);
  const matches = fs.readdirSync(dir).filter((file) => pattern.test(file));

  if (matches.length !== 1) {
    throw new Error(`Expected one tarball for ${SCOPE}/${pkg} in ${dir}, found: ${matches.join(", ") || "none"}`);
  }

  return path.join(dir, matches[0]);
};

const listFiles = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

const expandWildcard = (pkgDir: string, key: string, target: string): IEntryPoint[] => {
  const [prefix, suffix] = target.split("*");
  const root = path.join(pkgDir, path.dirname(prefix));

  return listFiles(root)
    .map((file) => `./${path.relative(pkgDir, file).split(path.sep).join("/")}`)
    .filter((file) => file.startsWith(prefix) && file.endsWith(suffix))
    .map((file) => ({
      subpath: key.replace("*", file.slice(prefix.length, file.length - suffix.length)),
      jsFile: file,
    }));
};

const getEntryPoints = (pkgDir: string, packageJson: IPackageJson): IEntryPoint[] => {
  if (!packageJson.exports) {
    return [{ subpath: ".", jsFile: `./${packageJson.main ?? "index.js"}` }];
  }

  return Object.entries(packageJson.exports).flatMap(([key, value]) => {
    const target = typeof value === "string" ? value : value.default;

    return key.includes("*") ? expandWildcard(pkgDir, key, target) : [{ subpath: key, jsFile: target }];
  });
};

/**
 * Shims point at the bundled files by relative path rather than by package specifier,
 * so they resolve the same way under every TypeScript moduleResolution mode,
 * including node10, which ignores the bundled packages' `exports` maps.
 */
const writeShim = (stagingDir: string, pkgDir: string, pkg: string, entry: IEntryPoint): Record<string, string> => {
  const shimBase = `./${pkg}${entry.subpath.slice(1)}/index`;
  const shimPath = path.join(stagingDir, shimBase);
  const targetJs = path.join(pkgDir, entry.jsFile);
  const targetTypes = targetJs.replace(/\.js$/, ".d.ts");
  const specifier = path.relative(path.dirname(shimPath), targetJs.replace(/\.js$/, "")).split(path.sep).join("/");

  if (!fs.existsSync(targetJs)) {
    throw new Error(`Entry point ${SCOPE}/${pkg}${entry.subpath.slice(1)} points at missing file ${targetJs}`);
  }

  fs.mkdirSync(path.dirname(shimPath), { recursive: true });
  fs.writeFileSync(`${shimPath}.js`, `module.exports = require("${specifier}");\n`);

  if (!fs.existsSync(targetTypes)) {
    return { default: `${shimBase}.js` };
  }

  const hasDefault = /export default|as default\b/.test(fs.readFileSync(targetTypes, "utf8"));
  const typeLines = [`export * from "${specifier}";`];

  if (hasDefault) {
    typeLines.push(`export { default } from "${specifier}";`);
  }

  fs.writeFileSync(`${shimPath}.d.ts`, `${typeLines.join("\n")}\n`);

  return { types: `${shimBase}.d.ts`, default: `${shimBase}.js` };
};

const mergeDependencies = (target: Record<string, string>, source: IPackageJson): void => {
  Object.entries(source.dependencies ?? {})
    .filter(([name]) => !name.startsWith(`${SCOPE}/`))
    .forEach(([name, range]) => {
      if (target[name] && target[name] !== range) {
        throw new Error(`Conflicting ranges for ${name}: ${target[name]} vs ${range} (from ${source.name})`);
      }

      // eslint-disable-next-line no-param-reassign
      target[name] = range;
    });
};

export async function packExtended(): Promise<void> {
  const [tarballsDir, outDir] = process.argv.slice(2).map((arg) => path.resolve(arg));

  if (!tarballsDir || !outDir) {
    throw new Error("Usage: ts-node packExtended.ts <tarballs dir> <output dir>");
  }

  const stagingDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${NAME}-`));
  const dependencies: Record<string, string> = {};
  const exportsMap: Record<string, Record<string, string> | string> = {};
  const versions = new Set<string>();

  const pkgDirs = PACKAGES.map((pkg) => path.join(stagingDir, "node_modules", SCOPE, pkg));

  await Promise.all(
    PACKAGES.map((pkg, index) => {
      fs.mkdirSync(pkgDirs[index], { recursive: true });

      return tar.x({ f: findTarball(tarballsDir, pkg), C: pkgDirs[index], strip: 1 });
    }),
  );

  PACKAGES.forEach((pkg, index) => {
    const pkgDir = pkgDirs[index];
    const packageJson = readPackageJson(pkgDir);
    versions.add(packageJson.version);
    mergeDependencies(dependencies, packageJson);

    getEntryPoints(pkgDir, packageJson).forEach((entry) => {
      exportsMap[`./${pkg}${entry.subpath.slice(1)}`] = writeShim(stagingDir, pkgDir, pkg, entry);
    });
  });

  if (versions.size !== 1) {
    throw new Error(`Expected all packages to share one version, found: ${[...versions].join(", ")}`);
  }

  exportsMap["./package.json"] = "./package.json";

  const [version] = [...versions];
  const bundled = PACKAGES.map((pkg) => `${SCOPE}/${pkg}`);
  // npm pack only bundles packages that are also listed as dependencies
  bundled.forEach((name) => {
    dependencies[name] = version;
  });

  const packageJson = {
    name: NAME,
    version,
    description: `MACI packages (${PACKAGES.join(", ")}) bundled as one package`,
    exports: exportsMap,
    files: PACKAGES,
    dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
    bundleDependencies: bundled,
  };

  fs.writeFileSync(path.join(stagingDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  fs.mkdirSync(outDir, { recursive: true });
  execFileSync("npm", ["pack", "--pack-destination", outDir], { cwd: stagingDir, stdio: "inherit" });
  await fs.promises.rm(stagingDir, { recursive: true });
}

// An unhandled rejection exits with a non-zero code and prints the error
packExtended();
