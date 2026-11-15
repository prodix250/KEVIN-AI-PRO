package com.kevinai.pro;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.media.projection.MediaProjectionManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;

public class AssistActivity extends BridgeActivity {

    private static final int SCREEN_CAPTURE_REQUEST_CODE = 2001;
    private static final int AUDIO_PERMISSION_REQUEST_CODE = 2002;
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 2003;

    private WebView assistantWebView;
    private SpeechRecognizer speechRecognizer;
    private TextToSpeech textToSpeech;
    private boolean textToSpeechReady;
    private boolean audioEnabled = true;
    private boolean webBridgeReady;
    private boolean screenCaptureActive;
    private boolean screenCaptureRequestPending;
    private boolean voiceListeningEnabled;
    private boolean waitingForNotificationPermission;
    private boolean requestInFlight;
    private boolean webVoiceRecording;
    private String latestScreenFrameBase64;
    private String pendingPrompt;
    private String pendingImageBase64;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private TextView statusLabel;
    private TextView microphoneButton;
    private TextView screenShareButton;
    private TextView audioToggleButton;
    private TextView responseLabel;
    private EditText screenPrompt;

    private final BroadcastReceiver screenCaptureReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (ScreenCaptureService.ACTION_SCREEN_FRAME.equals(intent.getAction())) {
                String frame = intent.getStringExtra(ScreenCaptureService.EXTRA_FRAME);
                if (screenCaptureActive && frame != null) {
                    latestScreenFrameBase64 = frame;
                    screenCaptureRequestPending = false;
                    screenShareButton.setText("■ Live screen active");
                    if (!requestInFlight && !webVoiceRecording && voiceListeningEnabled) {
                        startWebVoiceRecording();
                    }
                }
            } else if (ScreenCaptureService.ACTION_STOP.equals(intent.getAction())) {
                screenCaptureActive = false;
                screenCaptureRequestPending = false;
                voiceListeningEnabled = false;
                latestScreenFrameBase64 = null;
                releaseSpeechRecognizer();
                if (!requestInFlight) {
                    screenShareButton.setText("🟢 ↑ Share screen with Live");
                    setStatus("Ready");
                }
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        super.onCreate(savedInstanceState);
        setFinishOnTouchOutside(true);
        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN |
                        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN |
                        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        );
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));

        assistantWebView = getBridge() == null ? null : getBridge().getWebView();
        if (assistantWebView != null) {
            ViewParent parent = assistantWebView.getParent();
            if (parent instanceof ViewGroup) {
                ((ViewGroup) parent).removeView(assistantWebView);
            }
            assistantWebView.addJavascriptInterface(new AssistantNativeBridge(), "KevinAssistantNative");
            assistantWebView.setBackgroundColor(Color.TRANSPARENT);
            assistantWebView.setAlpha(0f);
            assistantWebView.setFocusable(false);
            assistantWebView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        }

        setContentView(createAssistantView());
        configureWindow();
        initializeSpeech();

        IntentFilter filter = new IntentFilter();
        filter.addAction(ScreenCaptureService.ACTION_SCREEN_FRAME);
        filter.addAction(ScreenCaptureService.ACTION_STOP);
        ContextCompat.registerReceiver(
                this,
                screenCaptureReceiver,
                filter,
                ContextCompat.RECEIVER_NOT_EXPORTED
        );
    }

    private void configureWindow() {
        Window window = getWindow();
        window.setGravity(Gravity.BOTTOM);
        window.setLayout(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT
        );
    }

    private View createAssistantView() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.TRANSPARENT);

        if (assistantWebView != null) {
            root.addView(assistantWebView, new FrameLayout.LayoutParams(dp(1), dp(1)));
        }

        View dimmedArea = new View(this);
        dimmedArea.setBackgroundColor(Color.argb(100, 0, 0, 0));
        dimmedArea.setOnClickListener(view -> finish());
        root.addView(dimmedArea, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(14), dp(18), dp(16));
        card.setBackground(roundDrawable(Color.rgb(17, 27, 33), Color.rgb(0, 168, 132), dp(24)));
        FrameLayout.LayoutParams cardParams = new FrameLayout.LayoutParams(
                dp(348),
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL
        );
        root.addView(card, cardParams);

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        card.addView(header, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        TextView title = label("Kevin AI", 17, Color.rgb(0, 255, 136));
        header.addView(title, new LinearLayout.LayoutParams(0, dp(32), 1));

        audioToggleButton = label("🔊", 20, Color.rgb(185, 225, 210));
        audioToggleButton.setGravity(Gravity.CENTER);
        audioToggleButton.setContentDescription("Toggle Kevin AI voice output");
        audioToggleButton.setOnClickListener(view -> toggleAudio());
        header.addView(audioToggleButton, new LinearLayout.LayoutParams(dp(42), dp(38)));

        TextView close = label("×", 28, Color.rgb(185, 225, 210));
        close.setGravity(Gravity.CENTER);
        close.setContentDescription("Close assistant");
        close.setOnClickListener(view -> finish());
        header.addView(close, new LinearLayout.LayoutParams(dp(38), dp(38)));

        statusLabel = label("Ready", 11, Color.rgb(185, 225, 210));
        statusLabel.setAlpha(0.85f);
        card.addView(statusLabel, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(24)
        ));

        responseLabel = label("", 13, Color.WHITE);
        responseLabel.setGravity(Gravity.TOP);
        responseLabel.setMaxLines(4);
        responseLabel.setEllipsize(android.text.TextUtils.TruncateAt.END);
        card.addView(responseLabel, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(64)
        ));

        screenPrompt = new EditText(this);
        screenPrompt.setSingleLine(true);
        screenPrompt.setTextColor(Color.WHITE);
        screenPrompt.setHintTextColor(Color.rgb(145, 180, 168));
        screenPrompt.setTextSize(13);
        screenPrompt.setHint("Ask about the current screen (optional)");
        screenPrompt.setPadding(dp(12), 0, dp(12), 0);
        screenPrompt.setBackground(roundDrawable(Color.rgb(25, 42, 48), Color.rgb(0, 120, 95), dp(12)));
        LinearLayout.LayoutParams promptParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(42)
        );
        promptParams.bottomMargin = dp(2);
        card.addView(screenPrompt, promptParams);

        screenShareButton = actionButton("🟢 ↑ Share screen with Live");
        screenShareButton.setOnClickListener(view -> toggleScreenCapture());
        LinearLayout.LayoutParams screenParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(46)
        );
        screenParams.topMargin = dp(8);
        card.addView(screenShareButton, screenParams);

        microphoneButton = actionButton("🎙 Speak to Kevin AI");
        microphoneButton.setOnClickListener(view -> toggleSpeechRecognition());
        LinearLayout.LayoutParams microphoneParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(46)
        );
        microphoneParams.topMargin = dp(8);
        card.addView(microphoneButton, microphoneParams);

        card.setAlpha(0f);
        card.setTranslationY(dp(24));
        card.post(() -> card.animate()
                .alpha(1f)
                .translationY(0f)
                .setDuration(220)
                .start());

        return root;
    }

    private void initializeSpeech() {
        textToSpeech = new TextToSpeech(this, status -> {
            textToSpeechReady = status == TextToSpeech.SUCCESS;
            if (textToSpeechReady) {
                textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {
                        runOnUiThread(() -> setStatus("Speaking"));
                    }

                    @Override
                    public void onDone(String utteranceId) {
                        runOnUiThread(() -> {
                            if (!isFinishing()) {
                                if (screenCaptureActive && voiceListeningEnabled) {
                                    setStatus("Live screen active");
                                    scheduleLiveVoiceInput();
                                } else {
                                    setStatus("Ready");
                                }
                            }
                        });
                    }

                    @Override
                    public void onError(String utteranceId) {
                        runOnUiThread(() -> {
                            setStatus("Voice output unavailable");
                            scheduleLiveVoiceInput();
                        });
                    }
                });
            }
        });
    }

    private void toggleAudio() {
        audioEnabled = !audioEnabled;
        audioToggleButton.setText(audioEnabled ? "🔊" : "🔇");
        if (!audioEnabled && textToSpeech != null) {
            textToSpeech.stop();
            scheduleLiveVoiceInput();
            setStatus("Voice output muted");
        } else {
            setStatus("Voice output enabled");
        }
    }

    private void toggleSpeechRecognition() {
        if (voiceListeningEnabled) {
            voiceListeningEnabled = false;
            stopWebVoiceRecording(screenCaptureActive ? latestScreenFrameBase64 : null);
            setStatus(screenCaptureActive ? "Live screen active" : "Processing");
            return;
        }
        voiceListeningEnabled = true;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[] { Manifest.permission.RECORD_AUDIO },
                    AUDIO_PERMISSION_REQUEST_CODE
            );
            return;
        }
        startWebVoiceRecording();
    }

    private void startSpeechRecognition() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            setStatus("Microphone permission required");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            setStatus("Speech recognition unavailable");
            return;
        }
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        speechRecognizer.setRecognitionListener(new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                setStatus("Listening");
                microphoneButton.setText("■ Stop listening");
            }

            @Override
            public void onBeginningOfSpeech() {
                setStatus("Listening");
            }

            @Override
            public void onEndOfSpeech() {
                setStatus("Processing");
            }

            @Override
            public void onResults(Bundle results) {
                ArrayList<String> matches = results.getStringArrayList(
                        SpeechRecognizer.RESULTS_RECOGNITION
                );
                String prompt = matches == null || matches.isEmpty() ? "" : matches.get(0).trim();
                releaseSpeechRecognizer();
                if (prompt.isEmpty()) {
                    if (screenCaptureActive && voiceListeningEnabled) {
                        scheduleLiveVoiceInput();
                    } else {
                        setStatus("I did not catch that");
                    }
                    return;
                }
                if (screenCaptureActive && voiceListeningEnabled
                        && latestScreenFrameBase64 == null) {
                    setStatus("Waiting for screen");
                    scheduleLiveVoiceInput();
                    return;
                }
                sendAssistantRequest(
                        prompt,
                        screenCaptureActive ? latestScreenFrameBase64 : null
                );
            }

            @Override
            public void onError(int error) {
                releaseSpeechRecognizer();
                if (screenCaptureActive && voiceListeningEnabled) {
                    setStatus(error == SpeechRecognizer.ERROR_NO_MATCH
                            ? "Listening again"
                            : "Microphone error");
                    scheduleLiveVoiceInput();
                } else {
                    setStatus(error == SpeechRecognizer.ERROR_NO_MATCH
                            ? "I did not catch that"
                            : "Microphone error");
                }
            }

            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onPartialResults(Bundle partialResults) {}
            @Override public void onEvent(int eventType, Bundle params) {}
            @Override public void onRmsChanged(float rmsdB) {}
        });

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault());
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        speechRecognizer.startListening(intent);
        setStatus("Starting microphone");
    }

    private void releaseSpeechRecognizer() {
        if (speechRecognizer != null) {
            speechRecognizer.destroy();
            speechRecognizer = null;
        }
        microphoneButton.setText("🎙 Speak to Kevin AI");
    }

    private void scheduleLiveVoiceInput() {
        mainHandler.postDelayed(() -> {
            if (screenCaptureActive
                    && voiceListeningEnabled
                    && !requestInFlight
                    && !webVoiceRecording) {
                startWebVoiceRecording();
            }
        }, 350);
    }

    private void toggleScreenCapture() {
        if (screenCaptureActive) {
            stopScreenCapture();
            return;
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(
                        this,
                        Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED) {
            waitingForNotificationPermission = true;
            ActivityCompat.requestPermissions(
                    this,
                    new String[] { Manifest.permission.POST_NOTIFICATIONS },
                    NOTIFICATION_PERMISSION_REQUEST_CODE
            );
            setStatus("Allow notifications to start Live");
            return;
        }
        requestScreenCapturePermission();
    }

    private void requestScreenCapturePermission() {
        MediaProjectionManager manager =
                (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            setStatus("Screen sharing unavailable");
            return;
        }
        setStatus("Requesting screen access");
        startActivityForResult(manager.createScreenCaptureIntent(), SCREEN_CAPTURE_REQUEST_CODE);
    }

    private void stopScreenCapture() {
        screenCaptureRequestPending = false;
        screenCaptureActive = false;
        voiceListeningEnabled = false;
        latestScreenFrameBase64 = null;
        stopWebVoiceRecording(null);
        releaseSpeechRecognizer();
        Intent intent = new Intent(this, ScreenCaptureService.class)
                .setAction(ScreenCaptureService.ACTION_STOP);
        startService(intent);
        if (!requestInFlight) {
            screenShareButton.setText("🟢 ↑ Share screen with Live");
            setStatus("Ready");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != SCREEN_CAPTURE_REQUEST_CODE) {
            return;
        }
        if (resultCode != RESULT_OK || data == null) {
            setStatus("Screen access was cancelled");
            return;
        }
        Intent serviceIntent = new Intent(this, ScreenCaptureService.class)
                .setAction(ScreenCaptureService.ACTION_START)
                .putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
                .putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data);
        ContextCompat.startForegroundService(this, serviceIntent);
        screenCaptureActive = true;
        screenCaptureRequestPending = true;
        latestScreenFrameBase64 = null;
        voiceListeningEnabled = true;
        screenShareButton.setText("■ Live screen active");
        setStatus("Capturing screen");
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[] { Manifest.permission.RECORD_AUDIO },
                    AUDIO_PERMISSION_REQUEST_CODE
            );
        }
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST_CODE) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            boolean shouldContinue = waitingForNotificationPermission;
            waitingForNotificationPermission = false;
            if (granted && shouldContinue) {
                requestScreenCapturePermission();
            } else if (shouldContinue) {
                setStatus("Notifications are required for Live");
            }
        } else if (requestCode == AUDIO_PERMISSION_REQUEST_CODE
                && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startWebVoiceRecording();
        } else if (requestCode == AUDIO_PERMISSION_REQUEST_CODE) {
            voiceListeningEnabled = false;
            setStatus("Microphone permission denied");
        }
    }

    private void startWebVoiceRecording() {
        if (!webBridgeReady || assistantWebView == null || webVoiceRecording) {
            if (!webBridgeReady) {
                setStatus("Preparing microphone");
            }
            return;
        }
        webVoiceRecording = true;
        setStatus("Listening");
        microphoneButton.setText("■ Stop listening");
        assistantWebView.evaluateJavascript(
                "window.KevinAssistantBridge && window.KevinAssistantBridge.startVoice && "
                        + "window.KevinAssistantBridge.startVoice();",
                null
        );
    }

    private void stopWebVoiceRecording(String imageBase64) {
        if (!webVoiceRecording || assistantWebView == null) {
            return;
        }
        webVoiceRecording = false;
        setStatus(imageBase64 == null ? "Processing" : "Analyzing screen");
        microphoneButton.setText("🎙 Speak to Kevin AI");
        String imageArgument = imageBase64 == null
                ? ""
                : JSONObject.quote(imageBase64);
        assistantWebView.evaluateJavascript(
                "window.KevinAssistantBridge && window.KevinAssistantBridge.stopVoice && "
                        + "window.KevinAssistantBridge.stopVoice(" + imageArgument + ");",
                null
        );
    }

    private void sendAssistantRequest(String prompt, String imageBase64) {
        if (requestInFlight) {
            setStatus("Kevin AI is still processing");
            return;
        }
        requestInFlight = true;
        pendingPrompt = prompt;
        pendingImageBase64 = imageBase64;
        setStatus(imageBase64 == null ? "Processing" : "Analyzing screen");
        if (!webBridgeReady || assistantWebView == null) {
            return;
        }
        dispatchPendingRequest();
    }

    private void dispatchPendingRequest() {
        if (!requestInFlight || assistantWebView == null || !webBridgeReady) {
            return;
        }
        try {
            JSONObject payload = new JSONObject();
            payload.put("prompt", pendingPrompt);
            if (pendingImageBase64 != null) {
                payload.put("imageBase64", pendingImageBase64);
            }
            String script = "window.KevinAssistantBridge && window.KevinAssistantBridge.send("
                    + JSONObject.quote(payload.toString()) + ");";
            assistantWebView.evaluateJavascript(script, null);
        } catch (JSONException exception) {
            requestInFlight = false;
            setStatus("Unable to prepare request");
            android.util.Log.e("AssistActivity", "Unable to prepare assistant request", exception);
        }
    }

    private void handleGeminiResponse(String response) {
        runOnUiThread(() -> {
            requestInFlight = false;
            pendingPrompt = null;
            pendingImageBase64 = null;
            if (response == null || response.trim().isEmpty()) {
                setStatus("Kevin AI returned no answer");
                return;
            }
            responseLabel.setText(response.trim());
            speakResponse(response);
        });
    }

    private void handleGeminiError(String message) {
        runOnUiThread(() -> {
            requestInFlight = false;
            pendingPrompt = null;
            pendingImageBase64 = null;
            responseLabel.setText(message);
            setStatus(message == null || message.trim().isEmpty()
                    ? "Kevin AI could not answer"
                    : "Error: " + message);
        });
    }

    private void speakResponse(String response) {
        if (!audioEnabled) {
            if (screenCaptureActive && voiceListeningEnabled) {
                scheduleLiveVoiceInput();
            }
            setStatus("Ready");
            return;
        }
        if (!textToSpeechReady || textToSpeech == null) {
            setStatus("Voice output unavailable");
            scheduleLiveVoiceInput();
            return;
        }
        String spokenText = response
                .replaceAll("!\\[[^\\]]*\\]\\([^)]*\\)", "image")
                .replaceAll("\\[[^\\]]*\\]\\([^)]*\\)", "")
                .replaceAll("[*_`#>]", "")
                .trim();
        Locale voiceLocale = selectVoiceLocale(spokenText);
        textToSpeech.setLanguage(voiceLocale);
        textToSpeech.setSpeechRate(1.0f);
        textToSpeech.setPitch(1.0f);
        textToSpeech.speak(spokenText, TextToSpeech.QUEUE_FLUSH, null, "kevin-response");
        setStatus("Speaking");
    }

    private Locale selectVoiceLocale(String text) {
        Locale[] preferredLocales = looksLikeKinyarwanda(text)
            ? new Locale[] {
                    Locale.forLanguageTag("rw-RW"),
                    Locale.forLanguageTag("sw-KE"),
                    Locale.FRANCE,
                    Locale.US
            }
            : new Locale[] {
                    Locale.US,
                    Locale.UK,
                    Locale.getDefault(),
                    Locale.forLanguageTag("sw-KE"),
                    Locale.FRANCE
            };
        for (Locale locale : preferredLocales) {
                if (textToSpeech.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE
                        && textToSpeech.setLanguage(locale) >= TextToSpeech.LANG_AVAILABLE) {
                return locale;
            }
        }
            textToSpeech.setLanguage(Locale.US);
        return Locale.US;
    }

    private boolean looksLikeKinyarwanda(String text) {
        String lowerText = text.toLowerCase(Locale.ROOT);
        String[] kinyarwandaMarkers = {
            "muraho", "amakuru", "urakoze", "ndabashimiye", "ndashaka",
            "nshaka", "yego", "oya", "ni nde", "gute", "cyangwa",
            "umuntu", "uyu", "wabigenza", "ufasha", "mwaramutse",
            "mwiriwe", "ndashimira", "sinzi", "mbabarira"
        };
        for (String marker : kinyarwandaMarkers) {
        if (lowerText.contains(marker)) {
            return true;
        }
        }
        return false;
    }

    private void setStatus(String status) {
        if (statusLabel != null) {
            statusLabel.setText(status);
        }
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        try {
            unregisterReceiver(screenCaptureReceiver);
        } catch (IllegalArgumentException ignored) {
            // Receiver was not registered.
        }
        releaseSpeechRecognizer();
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }
        if (screenCaptureActive) {
            stopScreenCapture();
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView actionButton(String text) {
        TextView button = label(text, 13, Color.WHITE);
        button.setGravity(Gravity.CENTER);
        button.setBackground(roundDrawable(Color.rgb(0, 168, 132), Color.rgb(37, 211, 102), dp(18)));
        button.setClickable(true);
        return button;
    }

    private TextView label(String text, int size, int color) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(color);
        view.setTextSize(size);
        view.setGravity(Gravity.CENTER_VERTICAL);
        return view;
    }

    private GradientDrawable roundDrawable(int fill, int stroke, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(radius);
        drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private final class AssistantNativeBridge {
        @JavascriptInterface
        public void onAssistantReady() {
            runOnUiThread(() -> {
                webBridgeReady = true;
                dispatchPendingRequest();
            });
        }

        @JavascriptInterface
        public void onGeminiResponse(String response) {
            handleGeminiResponse(response);
        }

        @JavascriptInterface
        public void onGeminiError(String message) {
            handleGeminiError(message);
        }

        @JavascriptInterface
        public void onAssistantVoiceStarted() {
            runOnUiThread(() -> {
                webVoiceRecording = true;
                setStatus("Listening");
            });
        }

        @JavascriptInterface
        public void onAssistantVoiceStopped() {
            runOnUiThread(() -> {
                webVoiceRecording = false;
                microphoneButton.setText("🎙 Speak to Kevin AI");
            });
        }
    }
}
