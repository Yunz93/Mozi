import {
  parseExcalidrawDocument,
  type ExcalidrawDocument,
} from "./excalidrawDocument";

export function createExcalidrawEmbedContainer(
  document: Document,
  options: {
    title: string;
    path: string;
    width?: number;
    height?: number;
  },
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "preview-attachment-excalidraw";
  container.dataset.attachmentPath = options.path;
  container.dataset.attachmentName = options.title;
  container.dataset.excalidrawState = "pending";
  container.title = options.title;
  if (options.width) {
    container.style.width = `${options.width}px`;
    container.dataset.wikiEmbedW = String(options.width);
  }
  if (options.height) {
    container.style.height = `${options.height}px`;
    container.dataset.wikiEmbedH = String(options.height);
  }

  const status = document.createElement("div");
  status.className = "preview-attachment-excalidraw-status";
  status.textContent = "Loading drawing…";
  container.appendChild(status);
  return container;
}

export async function renderExcalidrawEmbedSvg(
  container: HTMLElement,
  content: string,
  options?: { title?: string },
): Promise<void> {
  const doc = parseExcalidrawDocument(content);
  if (!doc) {
    container.dataset.excalidrawState = "error";
    container.textContent = "Invalid Excalidraw file";
    return;
  }

  try {
    const svg = await exportExcalidrawDocumentToSvg(doc);
    container.dataset.excalidrawState = "ready";
    container.replaceChildren();

    const figure = document.createElement("figure");
    figure.className = "preview-attachment-excalidraw-figure";

    svg.classList.add("preview-attachment-excalidraw-svg");
    svg.setAttribute("role", "img");
    if (options?.title) {
      svg.setAttribute("aria-label", options.title);
    }
    figure.appendChild(svg);

    if (options?.title) {
      const caption = document.createElement("figcaption");
      caption.className = "preview-attachment-excalidraw-caption";
      caption.textContent = options.title;
      figure.appendChild(caption);
    }

    container.appendChild(figure);
  } catch (error) {
    console.warn("Failed to render Excalidraw embed:", error);
    container.dataset.excalidrawState = "error";
    container.textContent = "Failed to preview drawing";
  }
}

async function exportExcalidrawDocumentToSvg(
  doc: ExcalidrawDocument,
): Promise<SVGSVGElement> {
  const { exportToSvg, restore } = await import("@excalidraw/excalidraw");
  const restored = restore(
    {
      elements: doc.elements as never,
      appState: doc.appState as never,
      files: doc.files as never,
    },
    null,
    null,
  );

  return exportToSvg({
    elements: restored.elements,
    appState: {
      ...restored.appState,
      exportBackground: true,
      exportWithDarkMode: false,
    },
    files: restored.files,
    exportPadding: 16,
  });
}
