'use client';

import { useState } from 'react';
import { PodcastPlayer } from '@/components/podcast/podcast-player';
import { EpisodeList } from '@/components/podcast/episode-list';
import { PodcastHeader } from '@/components/podcast/podcast-header';

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

interface PodcastData {
  title: string;
  description: string;
  image: string;
  author: string;
  link: string;
  language: string;
  totalEpisodes: number;
  hasMore: boolean;
  episodes: Episode[];
}

interface PodcastClientPageProps {
  podcast: PodcastData;
  locale: string;
}

export function PodcastClientPage({ podcast, locale }: PodcastClientPageProps) {
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const handleEpisodeSelect = (episode: Episode, index: number) => {
    setSelectedEpisode(episode);
    setSelectedIndex(index);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Podcast Header */}
      <PodcastHeader podcast={podcast} locale={locale} />

      {/* Audio Player - Sticky */}
      <div className="sticky top-4 z-10 mb-8">
        <PodcastPlayer
          episodes={podcast.episodes}
          locale={locale}
          currentEpisode={selectedEpisode}
          currentIndex={selectedIndex}
          onEpisodeSelect={handleEpisodeSelect}
        />
      </div>

      {/* Episode List with Load More */}
      <EpisodeList
        initialEpisodes={podcast.episodes}
        totalEpisodes={podcast.totalEpisodes}
        hasMore={podcast.hasMore}
        onEpisodeSelectAction={handleEpisodeSelect}
        locale={locale}
      />
    </div>
  );
}
