// /awards — badges for what you have done on the board, each with bronze, silver and gold tiers.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mascot } from '../components/Reward';
import { api } from '../lib/api';
import { badgeImage, FAMILY_TITLES, progress, TIER_NAMES, type Award, type AwardFamily } from '../lib/awards';
import { formatNumber } from '../lib/format';

export function AwardsPage() {
  const { t } = useTranslation('awards');
  const [awards, setAwards] = useState<Award[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    document.body.dataset.page = 'awards';
    api<{ awards: Award[] }>('api/achievements').then(data => setAwards(data.awards), e => setError((e as Error).message));
    return () => { document.body.dataset.page = 'board'; };
  }, []);

  if (error) return <p className="page-status" role="alert">{error}</p>;
  if (!awards) return <p className="page-status">{t('loading')}</p>;

  const earned = awards.filter(a => a.level > 0).length;
  const tally = (level: number) => awards.filter(a => a.level === level).length;
  const detail = awards.find(a => a.id === selected) ?? null;

  return (
    <section id="awards" className="awards" aria-label={t('label')}>
      <header className="awards-hero">
        <Mascot pose={tally(4) ? 'trophy' : earned ? 'confetti' : 'determined'} size={120} />
        <div>
          <h2>{t('earned', { count: earned, total: awards.length })}</h2>
          <p>{t('intro')}</p>
          <div className="awards-tally">
            {([4, 3, 2] as const).map(level => (
              <span key={level} className={`tally-${['', '', 'bronze', 'silver', 'gold'][level]}`}>
                <b>{tally(level)}</b> {TIER_NAMES[(['', '', 'bronze', 'silver', 'gold'] as const)[level]]}
              </span>
            ))}
          </div>
        </div>
      </header>
      {(Object.keys(FAMILY_TITLES) as AwardFamily[]).map(family => (
        <section key={family} className="awards-group" aria-label={FAMILY_TITLES[family]}>
          <h3>{FAMILY_TITLES[family]}</h3>
          <div className="awards-grid">
            {awards.filter(a => a.family === family).map(award => (
              <button key={award.id} type="button" className={`award-card tier-${award.tier}`} aria-pressed={selected === award.id}
                onClick={() => setSelected(selected === award.id ? null : award.id)}>
                <span className="award-art"><img src={badgeImage(award.id, award.tier)} alt="" loading="lazy" /></span>
                {award.level === 0 && <img className="award-lock" src="art/ui3d/locked.webp" alt="" width="26" height="26" />}
                <strong>{award.title}</strong>
                <span className="award-tier">{TIER_NAMES[award.tier]}</span>
                <span className="award-progress" aria-hidden="true"><i style={{ width: `${progress(award) * 100}%` }} /></span>
                <small>{award.next === null
                  ? t('maxed', { value: formatNumber(award.count), unit: award.unit })
                  : t('toNext', { value: formatNumber(award.count), next: formatNumber(award.next), unit: award.unit })}</small>
              </button>
            ))}
          </div>
          {detail?.family === family && <AwardDetail award={detail} />}
        </section>
      ))}
    </section>
  );
}

function AwardDetail({ award }: { award: Award }) {
  const steps = ['unlocked', 'bronze', 'silver', 'gold'] as const;
  return (
    <div className="award-detail" aria-live="polite">
      {award.level === 4 && <Mascot pose="clap" size={64} />}
      <div><h4>{award.title}</h4><p>{award.description}.</p></div>
      <ol className="award-steps">
        {steps.map((tier, index) => (
          <li key={tier} className={award.level > index ? 'done' : ''}>
            <img src={badgeImage(award.id, tier)} alt="" />
            <span>{TIER_NAMES[tier]}</span>
            <small>{formatNumber(award.thresholds[index])} {award.unit}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}
