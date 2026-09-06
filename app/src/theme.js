// MUI theme carrying the sim's DA: ink background, bright robot orange,
// system sans for copy, tight monospace for the OSD layers. Components keep
// most of their look in sx/styled - the theme only centralizes the tokens.
import { createTheme } from "@mui/material/styles";

export const INK = "#08080c";
export const ORANGE = "#ff7a2f";
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: ORANGE, contrastText: INK },
    background: { default: INK, paper: INK },
    text: {
      primary: "rgba(255, 255, 255, 0.85)",
      secondary: "rgba(255, 255, 255, 0.45)",
    },
  },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  shape: { borderRadius: 8 },
});
