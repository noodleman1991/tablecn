'use client';

import { useState, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import AudioPlayer from 'react-h5-audio-player';
import 'react-h5-audio-player/lib/styles.css';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, Calendar } from 'lucide-react';
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

interface PodcastPlayerProps {
  episodes: Episode[];
  locale?: string;
  currentEpisode?: Episode | null;
  currentIndex?: number;
  onEpisodeSelect?: (episode: Episode, index: number) => void;
}

export function PodcastPlayer({
  episodes,
  locale = 'en',
  currentEpisode = null,
  currentIndex = -1,
  onEpisodeSelect
}: PodcastPlayerProps) {
  const t = useTranslations('podcast');
  const playerRef = useRef<any>(null);

  const handleClickPrevious = useCallback(() => {
    if (currentIndex > 0 && onEpisodeSelect) {
      const prevEpisode = episodes[currentIndex - 1];
      onEpisodeSelect(prevEpisode, currentIndex - 1);
    }
  }, [currentIndex, episodes, onEpisodeSelect]);

  const handleClickNext = useCallback(() => {
    if (currentIndex < episodes.length - 1 && onEpisodeSelect) {
      const nextEpisode = episodes[currentIndex + 1];
      onEpisodeSelect(nextEpisode, currentIndex + 1);
    }
  }, [currentIndex, episodes, onEpisodeSelect]);

  const handlePlayError = useCallback((error: any) => {
    console.error('Audio play error:', error);
  }, []);

  // MSE configuration for future streaming capabilities
  const mseConfig = currentEpisode?.audioLength ? {
    srcDuration: currentEpisode.audioLength / 1000,
    onSeek: (event: any) => {
      console.log('Seek event:', event);
    },
    onEncrypted: (event: any) => {
      console.log('Encrypted media detected:', event);
    }
  } : undefined;

  // i18n aria labels
  const i18nAriaLabels = {
    play: t('player.play'),
    pause: t('player.pause'),
    rewind: t('player.rewind'),
    forward: t('player.forward'),
    previous: t('player.previous'),
    next: t('player.next'),
    volumeMute: t('player.mute'),
    volumeUnmute: t('player.unmute'),
    volume: t('player.volume'),
    currentTime: t('player.currentTime'),
    duration: t('player.duration'),
    progressBar: t('player.progressBar')
  };

  return (
    <Card className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <CardContent className="p-6">
        {currentEpisode ? (
          <div className="space-y-4">
            {/* Episode Info */}
            <div className="flex items-center space-x-4">
              {currentEpisode.image && (
                <img
                  src={currentEpisode.image}
                  alt={currentEpisode.title}
                  className="w-16 h-16 rounded-lg object-cover"
                />
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate">{currentEpisode.title}</h3>
                <div className="flex items-center space-x-3 text-sm text-muted-foreground">
                  {currentEpisode.duration && (
                    <span className="flex items-center">
                      <Clock className="w-3 h-3 mr-1" />
                      {currentEpisode.duration}
                    </span>
                  )}
                  <span className="flex items-center">
                    <Calendar className="w-3 h-3 mr-1" />
                    {formatDistanceToNow(currentEpisode.pubDate, {
                      addSuffix: true,
                      locale: dateLocales[locale as keyof typeof dateLocales]
                    })}
                  </span>
                  {currentEpisode.explicit && (
                    <Badge variant="destructive" className="text-xs">
                      {t('explicit')}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Advanced Audio Player */}
            <AudioPlayer
              ref={playerRef}
              src={currentEpisode.audioUrl}
              showSkipControls={episodes.length > 1}
              showJumpControls={true}
              showDownloadProgress={true}
              showFilledProgress={true}
              showFilledVolume={false}
              autoPlay={false}
              autoPlayAfterSrcChange={true}
              volumeJumpStep={0.1}
              progressJumpSteps={{ backward: 10000, forward: 30000 }}
              progressUpdateInterval={100}
              listenInterval={1000}
              timeFormat="auto"
              i18nAriaLabels={i18nAriaLabels}
              onClickPrevious={handleClickPrevious}
              onClickNext={handleClickNext}
              onPlayError={handlePlayError}
              customAdditionalControls={[]}
              layout="horizontal"
              className="[&_.rhap_container]:bg-transparent [&_.rhap_main]:flex-col [&_.rhap_main]:gap-2"
            />
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">{t('selectEpisode')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
