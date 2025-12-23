'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Play, ExternalLink, Loader2, Clock, Calendar } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { enUS, nl } from 'date-fns/locale';

const dateLocales = { en: enUS, nl: nl };

interface Episode {
  id: string;
  title: string;
  description: string;
  audioUrl: string;
  audioType: string;
  audioLength: number;
  duration: string;
  pubDate: Date;
  image: string;
  episodeNumber: string;
  seasonNumber: string;
  episodeType: string;
  explicit: boolean;
  spotifyUrl: string;
  applePodcastsUrl: string;
}

interface EpisodeListProps {
  initialEpisodes: Episode[];
  totalEpisodes: number;
  hasMore: boolean;
  onEpisodeSelectAction: (episode: Episode, index: number) => void;
  locale?: string;
}

export function EpisodeList({
  initialEpisodes,
  totalEpisodes,
  hasMore,
  onEpisodeSelectAction,
  locale = 'en'
}: EpisodeListProps) {
  const t = useTranslations('podcast');
  const [episodes, setEpisodes] = useState(initialEpisodes);
  const [loading, setLoading] = useState(false);
  const [canLoadMore, setCanLoadMore] = useState(hasMore);

  const loadMoreEpisodes = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/podcast?limit=6&offset=${episodes.length}`);
      if (!response.ok) throw new Error('Failed to fetch more episodes');

      const data = await response.json();

      setEpisodes(prev => [...prev, ...data.episodes]);
      setCanLoadMore(data.hasMore);
    } catch (error) {
      console.error('Failed to load more episodes:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Episode Count */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold">{t('title')}</h2>
        <Badge variant="secondary" className="text-sm">
          {t('episodeCount', { count: episodes.length, total: totalEpisodes })}
        </Badge>
      </div>

      {/* Episodes List */}
      <div className="space-y-4">
        {episodes.map((episode, index) => (
          <EpisodeCard
            key={episode.id}
            episode={episode}
            episodeNumber={episodes.length - index}
            onPlay={() => onEpisodeSelectAction(episode, index)}
            locale={locale}
          />
        ))}
      </div>

      {/* Load More Button */}
      {canLoadMore && (
        <div className="flex justify-center pt-6">
          <Button
            onClick={loadMoreEpisodes}
            disabled={loading}
            variant="outline"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('loading')}
              </>
            ) : (
              t('loadMore')
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

interface EpisodeCardProps {
  episode: Episode;
  episodeNumber: number;
  onPlay: () => void;
  locale: string;
}

function EpisodeCard({ episode, episodeNumber, onPlay, locale }: EpisodeCardProps) {
  const t = useTranslations('podcast');

  return (
    <Card className="hover:shadow-md transition-all duration-200 hover:border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg leading-tight">
              <span className="line-clamp-2">
                {episode.title}
              </span>
            </CardTitle>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center">
                <Calendar className="w-3 h-3 mr-1" />
                {formatDistanceToNow(episode.pubDate, {
                  addSuffix: true,
                  locale: dateLocales[locale as keyof typeof dateLocales]
                })}
              </span>
              {episode.duration && (
                <span className="flex items-center">
                  <Clock className="w-3 h-3 mr-1" />
                  {episode.duration}
                </span>
              )}
              {episode.explicit && (
                <Badge variant="destructive" className="text-xs">
                  {t('explicit')}
                </Badge>
              )}
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0">
            #{episodeNumber}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="flex gap-4">
          {/* Episode Thumbnail */}
          {episode.image && (
            <div className="shrink-0 hidden sm:block">
              <img
                src={episode.image}
                alt={episode.title}
                className="w-20 h-20 rounded-lg object-cover"
              />
            </div>
          )}

          <div className="flex-1 space-y-3">
            {/* Description Preview */}
            <p className="text-sm text-muted-foreground leading-relaxed">
              <span className="line-clamp-2">
                {episode.description}
              </span>
            </p>

            <Separator />

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={onPlay}
                className="min-w-[120px]"
              >
                <Play className="w-4 h-4 mr-2" />
                {t('playEpisode')}
              </Button>

              <Button variant="outline" size="sm" asChild>
                <a
                  href={episode.spotifyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-[100px]"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  {t('openInSpotify')}
                </a>
              </Button>

              <Button variant="outline" size="sm" asChild>
                <a
                  href={episode.applePodcastsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-[100px]"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  {t('openInApple')}
                </a>
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
