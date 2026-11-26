const filePath = (context) => String(context.filename ?? "").replaceAll("\\", "/");

const noBaseUiOutsideUi = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Only the UI primitives layer (packages/ui/ or src/components/) may import @base-ui/react.",
    },
    messages: {
      noBaseUiOutsideUi:
        "Import Base UI through your shared UI wrapper. Only packages/ui/ or src/components/ may import @base-ui/react.",
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source?.value;

        if (typeof source !== "string" || !source.startsWith("@base-ui/react")) return;

        const file = filePath(context);

        if (file.includes("/packages/ui/") || file.includes("/src/components/")) return;

        context.report({ node, messageId: "noBaseUiOutsideUi" });
      },
    };
  },
};

export default noBaseUiOutsideUi;
