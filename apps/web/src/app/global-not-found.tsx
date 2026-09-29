import type { Metadata } from "next";
import PlatformLayout from "./(platform)/layout";
import NotFound from "./(platform)/not-found";

export const metadata: Metadata = {
  title: "Not found | Setryn Terminal",
};

/**
 * The landing and the platform are separate root layouts, so unmatched URLs have
 * no single layout to render inside. They resolve to the terminal's 404 inside
 * the platform shell.
 */
export default function GlobalNotFound() {
  return (
    <PlatformLayout>
      <NotFound />
    </PlatformLayout>
  );
}
