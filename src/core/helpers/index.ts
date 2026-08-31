/**
 * URL статического ассета из public/images (логотип, превью сценариев).
 * BASE_URL обязателен: на GitHub Pages приложение живёт под /<repo>/, и
 * абсолютный «/images/…» мимо базы бьёт в корень домена (404 в демке).
 * Vite гарантирует завершающий «/» у BASE_URL (в dev это просто «/»).
 */
export function getFullURL(url: string): string {
  return `${import.meta.env.BASE_URL}images/${url}`
}
