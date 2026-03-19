export interface Sentence {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  recordingUrl?: string;
  analysis?: string;
  keywords?: { word: string; explanation: string }[];
}

export interface Material {
  id: string;
  title: string;
  audioUrl: string;
  mediaType?: 'audio' | 'video';
  sentences: Sentence[];
  createdAt: number;
}
