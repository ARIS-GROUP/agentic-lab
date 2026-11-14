// PixiJS v8 génère ses shaders via new Function : ce module évite d'assouplir la CSP (pas de unsafe-eval).
import "pixi.js/unsafe-eval";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
