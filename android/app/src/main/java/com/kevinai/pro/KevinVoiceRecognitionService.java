package com.kevinai.pro;

import android.content.Intent;
import android.speech.RecognitionService;

public class KevinVoiceRecognitionService extends RecognitionService {
    @Override
    protected void onStartListening(Intent recognizerIntent, Callback listener) {
        // Voice capture and Gemini STT are handled inside KevinAssistantActivity.
    }

    @Override
    protected void onCancel(Callback listener) {}

    @Override
    protected void onStopListening(Callback listener) {}
}
