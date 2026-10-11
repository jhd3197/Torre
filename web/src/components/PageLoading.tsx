// The placeholder while a page's code chunk downloads (routes load lazily; see App.tsx).
import { useTranslation } from 'react-i18next';

export function PageLoading() {
  const { t } = useTranslation('common');
  return (
    <div className="page-loading" role="status" aria-label={t('page.loading')}>
      <span className="review-loading-spinner" aria-hidden="true" />
    </div>
  );
}
