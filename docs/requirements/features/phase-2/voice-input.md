# Voice Input

- [ ] Voice Input #status/planned #phase-2 #feature/advanced

## Goal
Add voice capture to agent chat so operators can speak prompts and have them transcribed into the conversation.

## Requirements

### Voice Capture
- Provide push-to-talk controls in the chat UI (web and future TUI).
- Use a local or cloud transcription service with configurable model selection.
- Display transcription for confirmation before sending to the agent.
- Respect privacy: allow opting out of audio capture and purge recordings after transcription.

### Transcription Features
- **Real-time transcription**: Live transcription display while speaking
- **Multiple language support**: Configurable language settings for transcription
- **Accuracy feedback**: Confidence scores and alternative transcriptions
- **Voice commands**: Special commands for agent control via voice

### Audio Management
- **Audio quality settings**: Configurable microphone input and quality settings
- **Noise cancellation**: Background noise filtering for better transcription
- **Audio format support**: Multiple audio formats and compression options
- **Privacy controls**: Granular control over audio storage and retention

## UX Requirements

### Voice Interface
- **Push-to-talk button**: Large, accessible button with visual feedback
- **Voice activity indicator**: Visual display when voice is detected
- **Transcription preview**: Editable text preview before sending to agent
- **Keyboard shortcuts**: Global hotkeys for voice activation and control

### Settings & Configuration
- **Transcription settings**: Model selection, language, and accuracy preferences
- **Audio settings**: Microphone selection, gain, and noise cancellation
- **Privacy settings**: Audio retention, recording permissions, and data handling
- **Accessibility**: Screen reader support and keyboard alternatives

### Feedback & Error Handling
- **Connection status**: Clear indication of transcription service connectivity
- **Error messages**: Helpful feedback for transcription failures
- **Quality indicators**: Audio level and transcription quality feedback
- **Fallback options**: Easy switch to text input when voice fails

## Implementation Details

### Audio Processing
- WebRTC integration for microphone access
- Audio streaming and buffering for real-time processing
- Audio compression and format optimization
- Background noise filtering and enhancement

### Transcription Integration
- Multiple transcription service support (local/cloud)
- API integration for real-time transcription
- Language detection and model selection
- Confidence scoring and alternative generation

### Privacy & Security
- Local audio processing when possible
- Secure transmission to cloud services
- Audio data encryption and secure storage
- Configurable retention and cleanup policies

## Integration Points
- **Agent Orchestration Engine**: Receives transcribed text as user input
- **Agent Chat UX**: Integrates voice controls into chat interface
- **Persistence Layer**: Stores audio settings and privacy preferences
- **Configuration System**: Manages transcription service settings

## Testing Strategy
- Test voice capture across different microphones and environments
- Verify transcription accuracy for different accents and languages
- Test privacy controls and audio cleanup functionality
- Test real-time transcription performance and latency
- Cross-browser compatibility for audio APIs
- Accessibility testing for screen readers and keyboard navigation

## Testing Strategy
*This section needs to be filled in with specific testing approaches for voice input functionality.*
