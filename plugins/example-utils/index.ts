export const slugifyText = (args: { text: string }) => {
  const slug = args.text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return { slug };
};
