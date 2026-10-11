import { forwardRef, type AnchorHTMLAttributes } from "react";
import { isNativeApp, openExternal } from "@/lib/platform";

/**
 * A link to a website outside Grammie. In a browser it opens a new tab, as
 * links always have; in the iPhone/iPad app it opens the in-app browser sheet
 * (a plain target="_blank" does nothing there). Works with <Button asChild>.
 */
export const ExternalAnchor = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(
  function ExternalAnchor({ href, onClick, children, ...rest }, ref) {
    return (
      <a
        ref={ref}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        {...rest}
        onClick={(e) => {
          onClick?.(e);
          if (e.defaultPrevented || !href || !isNativeApp()) return;
          e.preventDefault();
          void openExternal(href);
        }}
      >
        {children}
      </a>
    );
  },
);
