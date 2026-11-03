import ts from "typescript";

// Native forms post URL-encoded or multipart bodies. tsc and a GET preview
// both succeed when a generated POST handler instead expects JSON.
export function checkNativeForms(
  page: ts.SourceFile,
  files: Record<string, string>,
) {
  function visit(node: ts.Node) {
    if (
      ts.isJsxOpeningElement(node) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === "form"
    ) {
      const attributes = new Map<string, string>();
      for (const attr of node.attributes.properties) {
        if (
          !ts.isJsxAttribute(attr) ||
          !ts.isIdentifier(attr.name) ||
          attr.name.text === "onSubmit"
        )
          return;
        if (attr.initializer && ts.isStringLiteral(attr.initializer))
          attributes.set(attr.name.text, attr.initializer.text);
      }
      const action = attributes.get("action");
      if (
        attributes.get("method")?.toLowerCase() === "post" &&
        action &&
        /^\/api\/[\w/-]+$/.test(action)
      ) {
        const path = ["src/app", "app"]
          .map((prefix) => prefix + action + "/route.ts")
          .find((name) => Object.hasOwn(files, name));
        if (path) {
          const route = ts.createSourceFile(
            path,
            files[path],
            ts.ScriptTarget.Latest,
            false,
            ts.ScriptKind.TS,
          );
          const post = route.statements.find(
            (s): s is ts.FunctionDeclaration =>
              ts.isFunctionDeclaration(s) && s.name?.text === "POST",
          );
          const param = post?.parameters[0]?.name;
          if (post?.body && param && ts.isIdentifier(param)) {
            const requestName = param.text;
            const reads = new Set<string>();
            function calls(current: ts.Node) {
              if (
                ts.isCallExpression(current) &&
                ts.isPropertyAccessExpression(current.expression)
              ) {
                const callee = current.expression;
                if (
                  ts.isIdentifier(callee.expression) &&
                  callee.expression.text === requestName
                )
                  reads.add(callee.name.text);
              }
              ts.forEachChild(current, calls);
            }
            calls(post.body);
            if (
              reads.has("json") &&
              !["formData", "text", "arrayBuffer", "clone"].some((reader) =>
                reads.has(reader),
              )
            )
              throw Error(
                page.fileName +
                  " has a native POST form to " +
                  action +
                  " but " +
                  path +
                  " reads only JSON. Handle form fields using await request.formData() or send JSON deliberately from an interactive client form.",
              );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(page);
}
