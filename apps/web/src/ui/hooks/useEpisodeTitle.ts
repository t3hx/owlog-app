import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import type { EpisodeRank, MediaRef } from '@owlog/domain'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Titre de l'épisode que le CTA « épisode suivant » désigne.
 *
 * Le rang vient du domaine (`upcomingEpisodeRank`) : quand il est `null`, la
 * saison n'est pas connue et **rien n'est demandé** — pas de requête posée
 * puis ignorée. Quand il est connu, la saison entière est récupérée et
 * cachée par TanStack Query sous `['season', ref, saison, langue]` : avancer
 * d'un épisode ne recoûte pas un appel, seule la saison suivante en fera un.
 *
 * `null` couvre tous les silences d'un coup — hors-ligne, saison inconnue de
 * TMDB, épisode absent de la liste, titre vide. La fiche n'affiche alors
 * rien : un placeholder dirait « il manque quelque chose » là où il n'y a
 * rien à attendre.
 */
export function useEpisodeTitle(ref: MediaRef, rank: EpisodeRank | null): string | null {
  const { catalog } = usePorts()
  const { i18n } = useTranslation()

  // Même règle de langue que le détail de la fiche : le catalogue parle
  // fr-FR ou en-US, jamais la langue brute du navigateur.
  const language = (i18n.resolvedLanguage ?? 'fr').startsWith('en') ? 'en-US' : 'fr-FR'
  const season = rank?.season ?? null

  const { data } = useQuery({
    queryKey: ['season', ref, season, language],
    enabled: season !== null,
    // `season` est non nul dès que la requête est activée ; TanStack ne
    // rétrécit pas le type à travers `enabled`, d'où le repli impossible.
    queryFn: () => catalog.season(ref, season ?? 0, language),
  })

  if (rank === null || data === undefined || !data.ok) return null

  const episode = data.value.episodes.find((entry) => entry.episodeNumber === rank.episode)
  return episode === undefined || episode.name === '' ? null : episode.name
}
