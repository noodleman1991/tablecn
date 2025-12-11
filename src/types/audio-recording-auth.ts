export interface AudioRecordingSessionData {
  email: string;
  authorizedAt: number;
  expiresAt: number;
}

export interface AuthorizationResult {
  success: boolean;
  error?: string;
}
