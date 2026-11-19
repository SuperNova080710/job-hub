import type { Metadata } from 'next';
import './style.css';

export const metadata: Metadata = { title: 'Job Hub', description: '개인 채용공고와 지원 현황 관리' };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
