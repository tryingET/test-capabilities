declare module "js-yaml" {
  const yaml: {
    load(content: string): unknown;
  };

  export default yaml;
}
