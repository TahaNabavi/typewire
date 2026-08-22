# Fonts for generated images

Geist and Geist Mono, subset to the Latin ranges Google Fonts serves, checked in
so that `next/og` can render the site's Open Graph images without a network call
at build time. The web pages themselves do **not** use these files — they load
the same families through `next/font/google` in `app/layout.tsx`.

Only the faces the image template actually sets are here; every other weight
resolves to the nearest of these.

| File                    | Family     | Weight |
| ----------------------- | ---------- | ------ |
| Geist-Regular.ttf       | Geist      | 400    |
| Geist-Bold.ttf          | Geist      | 700    |
| GeistMono-SemiBold.ttf  | Geist Mono | 600    |

Both families are © 2023 Vercel, licensed under the SIL Open Font License 1.1
(<https://openfontlicense.org>). The OFL permits redistribution of the font files
alongside this notice; it does not permit selling the fonts on their own, and the
reserved font names ("Geist", "Geist Mono") apply to modified copies, of which
these are none — they are the upstream binaries as served by Google Fonts.
