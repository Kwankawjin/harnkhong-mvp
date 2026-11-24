// The React parts of the page (footer and profile badge) load as their own chunk, after the
// rest of the app, so the first screen does not wait for React and the 3D badge code.
import * as ReactModule from "react";
export { createRoot } from "react-dom/client";
export { default as DoodleCrewFooter } from "../components/ui/doodle-crew-footer.tsx";
export { default as LanyardBadge } from "../components/ui/lanyard-badge.tsx";
// React ships as CommonJS: depending on the bundler its API sits on the namespace or on default.
export const React = typeof ReactModule.createElement === "function" ? ReactModule : ReactModule.default;
