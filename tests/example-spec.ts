import { always, extract } from "@antithesishq/bombadil";
export { clicks } from "@antithesishq/bombadil/defaults/actions";

// Extract the page title
const title = extract((state) => 
    state.document.querySelector("h1")?.textContent ?? ""
);

// Invariant: page should always have a title
export const has_title = always(() => title.current.trim() !== "");
