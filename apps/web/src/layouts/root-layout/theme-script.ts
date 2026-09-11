/**
 * Applied before paint so a stored preference never flashes the other theme.
 * The server renders `data-theme="light"`; this only overrides it to dark, for
 * a reader who has asked for dark before.
 */
export const THEME_SCRIPT = `
try {
  if (localStorage.getItem("typewire-theme") === "dark")
    document.documentElement.setAttribute("data-theme", "dark");
} catch (e) {}
`
