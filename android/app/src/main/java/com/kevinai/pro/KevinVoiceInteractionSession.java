package com.kevinai.pro;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.service.voice.VoiceInteractionSession;

public class KevinVoiceInteractionSession extends VoiceInteractionSession {

    public KevinVoiceInteractionSession(Context context) {
        super(context);
    }

    @Override
    public void onShow(Bundle args, int showFlags) {
        super.onShow(args, showFlags);
        Intent overlayIntent = new Intent(getContext(), KevinAssistantActivity.class);
        overlayIntent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
                        | Intent.FLAG_ACTIVITY_NO_ANIMATION
        );
        getContext().startActivity(overlayIntent);
        finish();
    }
}
