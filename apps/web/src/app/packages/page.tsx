import { PackagesPage, PACKAGES_DESCRIPTION } from '@/features/packages'
import { pageMetadata } from '@/lib/seo'
import { PATHS } from '@/routes/paths'

export const metadata = pageMetadata({
  title: 'Packages',
  description: PACKAGES_DESCRIPTION,
  path: PATHS.PACKAGES,
  keywords: [
    'TypeWire packages',
    '@tahanabavi npm',
    'TypeScript contract packages',
  ],
})

export default function Page() {
  return <PackagesPage />
}
