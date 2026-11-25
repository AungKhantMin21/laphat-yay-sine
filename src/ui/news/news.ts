// Street news as text (M4): one line per news item (shared/properties.ts NEWS), with property and
// resident names from my.json. Used by the gossip line, the evening panel and the away summary.
import { t } from '../i18n';
import { LISTING, NEWS } from '../../shared/properties';

export interface NewsLike {
  kind: number;
  prop: string;
  a: string;
  b: string;
}

const who = (key: string): string => (key ? t(`resident.${key}`) : t('news.someone'));

/** The line for a news item, or '' for kinds nobody talks about. */
export function newsText(n: NewsLike): string {
  const place = n.prop ? t(`property.${n.prop}`) : '';
  switch (n.kind) {
    case NEWS.listed: {
      if (n.b === 'urgent') return t('news.urgent', { place });
      const l = Number(n.a);
      return t(l === LISTING.both ? 'news.listedBoth' : l === LISTING.rent ? 'news.listedRent' : 'news.listedSale', { place });
    }
    case NEWS.sold:
      return t('news.sold', { place });
    case NEWS.closed:
      return t('news.closed', { place });
    case NEWS.reopened:
      return t('news.reopened', { place });
    case NEWS.moved:
      return t('news.moved', { a: who(n.a), b: who(n.b) });
    case NEWS.withdrawn:
      return t('news.withdrawn', { place });
    case NEWS.yours:
      return t(n.a === 'rent' ? 'news.youRented' : n.a === 'ended' ? 'news.youGaveUp' : 'news.youBought', { place });
    default:
      return '';
  }
}

/** Kinds worth a line in a summary (your own doings and withdrawn listings are left out). */
export function newsWorthTelling(n: NewsLike): boolean {
  return n.kind !== NEWS.yours && n.kind !== NEWS.withdrawn;
}
