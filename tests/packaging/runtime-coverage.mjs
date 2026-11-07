import path from "node:path";
import ts from "typescript";

/** Follow literal module dependencies without executing code from the tarball. */
export function runtimeCoverage(entryMap, publicTargets) {
  const reachable = new Set(publicTargets);
  const missing = [];
  const queue = [...publicTargets];
  for (let i = 0; i < queue.length; i++) {
    const filename = queue[i];
    const entry = entryMap.get(filename);
    if (!entry || !/\.[cm]?js$/i.test(filename)) continue;
    const source = ts.createSourceFile(filename, entry.data.toString("utf8"), ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    function visit(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))) specifier = node.arguments[0];
      if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith(".")) {
        const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(filename), specifier.text));
        if (dependency.startsWith("../") || !entryMap.has(dependency)) missing.push({ from: filename, target: dependency });
        else if (!reachable.has(dependency)) { reachable.add(dependency); queue.push(dependency); }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return { reachable, missing };
}
