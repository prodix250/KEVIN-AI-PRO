package com.kevinai.pro;

import android.content.Intent;
import android.os.RemoteException;
import android.speech.RecognitionService;
import android.speech.SpeechRecognizer;

public class KevinVoiceRecognitionService extends RecognitionService {
    @Override
    protected void onStartListening(Intent recognizerIntent, Callback listener) {
        if (listener != null) {
            try {
                listener.error(SpeechRecognizer.ERROR_CLIENT);
            } catch (RemoteException ignored) {}
        }
    }

    @Override
    protected void onCancel(Callback listener) {}

    @Override
    protected void onStopListening(Callback listener) {}
}
