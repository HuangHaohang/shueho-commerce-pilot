declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  type PdfTextItem = { str: string } | Record<string, unknown>;

  type PdfDocument = {
    numPages: number;
    getPage(pageNumber: number): Promise<{
      getTextContent(): Promise<{ items: PdfTextItem[] }>;
    }>;
    destroy(): Promise<void>;
  };

  export function getDocument(options: {
    data: Uint8Array;
    disableWorker?: boolean;
    useSystemFonts?: boolean;
  }): { promise: Promise<PdfDocument> };
}
