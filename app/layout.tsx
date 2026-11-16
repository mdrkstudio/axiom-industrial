import type { Metadata } from 'next'
import './globals.css'
import './portfolio.css'

export const metadata: Metadata = {
  title: 'Промышленный пейзаж - интерактивный 3D-проект',
  description: 'Концептуальный 3D-проект: промышленная сцена, горный пейзаж, свет, материалы и движение камеры в ритме скролла.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
