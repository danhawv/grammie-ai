declare module 'pagedjs' {
  export class Previewer {
    preview(
      content: HTMLElement | string,
      stylesheets: string[],
      renderTo: HTMLElement
    ): Promise<{
      total: number;
      performance: string;
    }>;
  }

  export class Handler {
    afterPageLayout?(pageFragment: DocumentFragment, page: any): void;
    beforeParsed?(content: HTMLElement): void;
    afterRendered?(pages: NodeList): void;
  }

  export function registerHandlers(...handlers: typeof Handler[]): void;
}
