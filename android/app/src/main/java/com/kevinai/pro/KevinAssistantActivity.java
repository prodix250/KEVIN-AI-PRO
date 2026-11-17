package com.kevinai.pro;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.text.InputType;
import android.text.TextUtils;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class KevinAssistantActivity extends AppCompatActivity {

    private static final int REQ_RECORD_AUDIO = 2101;
    private static final int REQ_PICK_IMAGE = 2102;
    private static final int REQ_CAMERA_CAPTURE = 2103;
    private static final int REQ_SPEECH_FALLBACK = 2104;
    private static final int REQ_SCREEN_CAPTURE = 2105;
    private static final int REQ_POST_NOTIFICATIONS = 2106;

    private static final int COLOR_CARD_BG = Color.parseColor("#111B21");
    private static final int COLOR_CARD_BORDER = Color.parseColor("#1F3B34");
    private static final int COLOR_SURFACE = Color.parseColor("#1B2A32");
    private static final int COLOR_SURFACE_BORDER = Color.parseColor("#2A404A");
    private static final int COLOR_EMERALD = Color.parseColor("#00A884");
    private static final int COLOR_EMERALD_GLOW = Color.parseColor("#25D366");
    private static final int COLOR_TEXT_PRIMARY = Color.parseColor("#E9EDEF");
    private static final int COLOR_TEXT_SECONDARY = Color.parseColor("#8696A0");

    private KevinAgentBridge agentBridge;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private LinearLayout cardContainer;
    private EditText promptInput;
    private LinearLayout liveScreenRow;
    private ImageView liveScreenThumb;
    private TextView liveScreenTitle;
    private TextView liveScreenSubtitle;
    private TextView explainScreenBtn;
    private TextView liveToggleChip;
    private TextView autoLiveChip;
    private LinearLayout attachmentPreviewRow;
    private ImageView attachmentThumb;
    private LinearLayout responsePanel;
    private ScrollView responseScroll;
    private TextView submittedPromptView;
    private TextView replyTextView;
    private ProgressBar loadingSpinner;
    private TextView actionStatusBadge;
    private LinearLayout contactChoicesLayout;
    private TextView permissionActionBtn;
    private TextView micButton;
    private TextView sendButton;

    private SpeechRecognizer speechRecognizer;
    private boolean isListening = false;
    private boolean isSending = false;
    private boolean waitingForNotificationPermission = false;
    private boolean isLiveScreenSharing = false;
    private boolean awaitingInitialLiveExplanation = false;
    private boolean autoLivePromptedThisLaunch = false;

    private String pendingImageBase64 = null;
    private String pendingImageMimeType = "image/jpeg";
    private String latestScreenFrameBase64 = null;
    private String pendingActionType = null;
    private String pendingActionMessage = null;

    private final BroadcastReceiver screenVisionReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || intent.getAction() == null) return;
            String action = intent.getAction();
            if (ScreenCaptureService.ACTION_SCREEN_FRAME.equals(action)) {
                String frame = intent.getStringExtra(ScreenCaptureService.EXTRA_FRAME);
                if (!TextUtils.isEmpty(frame)) {
                    isLiveScreenSharing = true;
                    onNewScreenFrameReceived(frame, true);
                }
            } else if (ScreenCaptureService.ACTION_STOP.equals(action)) {
                isLiveScreenSharing = false;
                awaitingInitialLiveExplanation = false;
                updateLiveScreenControls();
            } else if (KevinVoiceInteractionSession.ACTION_ASSIST_SCREENSHOT.equals(action)) {
                loadAssistScreenshotFromCache();
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        } catch (Throwable ignored) {}

        agentBridge = new KevinAgentBridge(this, null);
        isLiveScreenSharing = ScreenCaptureService.isCaptureRunning;

        buildCompactOverlayUi();
        registerScreenVisionReceiver();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                dismissOverlay();
            }
        });

        handleIncomingIntent(getIntent());
        loadAssistScreenshotFromCache();
        maybeAutoStartLiveScreen();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        isLiveScreenSharing = ScreenCaptureService.isCaptureRunning;
        autoLivePromptedThisLaunch = false;
        updateLiveScreenControls();
        handleIncomingIntent(intent);
        loadAssistScreenshotFromCache();
        maybeAutoStartLiveScreen();
    }

    private void registerScreenVisionReceiver() {
        IntentFilter filter = new IntentFilter();
        filter.addAction(ScreenCaptureService.ACTION_SCREEN_FRAME);
        filter.addAction(ScreenCaptureService.ACTION_STOP);
        filter.addAction(KevinVoiceInteractionSession.ACTION_ASSIST_SCREENSHOT);
        ContextCompat.registerReceiver(this, screenVisionReceiver, filter, 4);
    }

    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        String extraPrompt = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (!TextUtils.isEmpty(extraPrompt) && promptInput != null) {
            promptInput.setText(extraPrompt);
            promptInput.setSelection(extraPrompt.length());
        }
    }

    private void maybeAutoStartLiveScreen() {
        if (isLiveScreenSharing || ScreenCaptureService.isCaptureRunning) {
            isLiveScreenSharing = true;
            updateLiveScreenControls();
            return;
        }
        if (KevinAgentPrefs.isAutoLiveScreenOnHome(this) && !autoLivePromptedThisLaunch) {
            autoLivePromptedThisLaunch = true;
            mainHandler.postDelayed(() -> {
                if (!isFinishing() && !isDestroyed() && !isLiveScreenSharing && !ScreenCaptureService.isCaptureRunning) {
                    requestLiveScreenShare();
                }
            }, 320L);
        }
    }

    private void loadAssistScreenshotFromCache() {
        executor.execute(() -> {
            try {
                File f = new File(getCacheDir(), KevinVoiceInteractionSession.ASSIST_SCREENSHOT_FILENAME);
                if (!f.exists() || f.length() < 100) return;
                byte[] bytes = new byte[(int) f.length()];
                try (FileInputStream fis = new FileInputStream(f)) {
                    int read = 0;
                    while (read < bytes.length) {
                        int n = fis.read(bytes, read, bytes.length - read);
                        if (n <= 0) break;
                        read += n;
                    }
                }
                final String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                mainHandler.post(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    if (!isLiveScreenSharing) {
                        onNewScreenFrameReceived(b64, false);
                    }
                });
            } catch (Throwable ignored) {}
        });
    }

    private void onNewScreenFrameReceived(String base64Jpeg, boolean isLiveStream) {
        latestScreenFrameBase64 = base64Jpeg;
        updateLiveScreenControls();

        try {
            byte[] decoded = Base64.decode(base64Jpeg, Base64.DEFAULT);
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = 4;
            Bitmap thumb = BitmapFactory.decodeByteArray(decoded, 0, decoded.length, opts);
            if (thumb != null && liveScreenThumb != null) {
                liveScreenThumb.setImageBitmap(thumb);
            }
        } catch (Throwable ignored) {}

        if (liveScreenRow != null) {
            liveScreenRow.setVisibility(View.VISIBLE);
            if (isLiveStream) {
                liveScreenTitle.setText("🟢 Live Screen Share irakora");
                liveScreenSubtitle.setText("Kevin AI irareba ibiri kuri screen yawe ako kanya");
            } else {
                liveScreenTitle.setText("👁 Screen iri inyuma yafashwe");
                liveScreenSubtitle.setText("Baza cyangwa ukande Sobanura ngo arebe ibiriho");
            }
        }

        if (isLiveStream && awaitingInitialLiveExplanation && !isSending) {
            awaitingInitialLiveExplanation = false;
            explainCurrentScreenAutomatically();
        }
    }

    private void explainCurrentScreenAutomatically() {
        if (TextUtils.isEmpty(latestScreenFrameBase64) || isSending) return;
        String prompt = "User amaze kwatsa Live Screen Share. Reba neza ibiri kuri iyi screen ya telefone ye, ubisobanure neza mu magambo magufi yumvikana mu Kinyarwanda (cyangwa mu rurimi ruri kuri screen), unamubwire icyo wamufashaho kuri ibyo ari kureba.";
        runScreenVisionPrompt("📺 Sobanura ibiri kuri screen ubu", prompt, latestScreenFrameBase64);
    }

    private void runScreenVisionPrompt(String displayPrompt, String fullPrompt, String frameBase64) {
        if (TextUtils.isEmpty(frameBase64) || isSending) return;
        hideKeyboard();
        prepareResponseUi(displayPrompt);
        isSending = true;
        String backendUrl = KevinAgentPrefs.getEffectiveBackendBaseUrl(this);
        streamFromBackend(backendUrl, fullPrompt, frameBase64, "image/jpeg");
    }

    private void buildCompactOverlayUi() {
        FrameLayout backdrop = new FrameLayout(this);
        backdrop.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        backdrop.setBackgroundColor(Color.argb(105, 0, 0, 0));
        backdrop.setOnClickListener(v -> dismissOverlay());

        cardContainer = new LinearLayout(this);
        cardContainer.setOrientation(LinearLayout.VERTICAL);
        cardContainer.setClickable(true);
        cardContainer.setFocusable(true);

        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setColor(COLOR_CARD_BG);
        cardBg.setCornerRadius(dp(28));
        cardBg.setStroke(dp(1), COLOR_CARD_BORDER);
        cardContainer.setBackground(cardBg);
        cardContainer.setElevation(dp(18));
        cardContainer.setPadding(dp(16), dp(14), dp(16), dp(14));

        FrameLayout.LayoutParams cardParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        cardParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        int sideMargin = dp(10);
        int bottomMargin = dp(12);
        cardParams.setMargins(sideMargin, dp(24), sideMargin, bottomMargin);

        backdrop.setOnApplyWindowInsetsListener((v, windowInsets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets insets = windowInsets.getInsets(
                        android.view.WindowInsets.Type.systemBars()
                                | android.view.WindowInsets.Type.ime()
                );
                v.setPadding(insets.left, insets.top, insets.right, insets.bottom);
                return android.view.WindowInsets.CONSUMED;
            } else {
                v.setPadding(
                        windowInsets.getSystemWindowInsetLeft(),
                        windowInsets.getSystemWindowInsetTop(),
                        windowInsets.getSystemWindowInsetRight(),
                        windowInsets.getSystemWindowInsetBottom()
                );
                return windowInsets.consumeSystemWindowInsets();
            }
        });

        // 1. Header Row (Kevin AI badge + Expand + Close)
        LinearLayout headerRow = new LinearLayout(this);
        headerRow.setOrientation(LinearLayout.HORIZONTAL);
        headerRow.setGravity(Gravity.CENTER_VERTICAL);
        headerRow.setPadding(dp(2), 0, dp(2), dp(8));

        View glowDot = new View(this);
        GradientDrawable dotDrawable = new GradientDrawable();
        dotDrawable.setShape(GradientDrawable.OVAL);
        dotDrawable.setColor(COLOR_EMERALD_GLOW);
        glowDot.setBackground(dotDrawable);
        LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(dp(10), dp(10));
        dotParams.setMarginEnd(dp(8));
        headerRow.addView(glowDot, dotParams);

        LinearLayout titleWrap = new LinearLayout(this);
        titleWrap.setOrientation(LinearLayout.HORIZONTAL);
        titleWrap.setGravity(Gravity.CENTER_VERTICAL);

        TextView titleView = new TextView(this);
        titleView.setText("Kevin AI");
        titleView.setTextColor(COLOR_TEXT_PRIMARY);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleWrap.addView(titleView);

        TextView badgeView = new TextView(this);
        badgeView.setText("Live Vision");
        badgeView.setTextColor(COLOR_EMERALD_GLOW);
        badgeView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        badgeView.setTypeface(Typeface.DEFAULT_BOLD);
        badgeView.setPadding(dp(8), dp(2), dp(8), dp(2));
        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setColor(Color.parseColor("#16362E"));
        badgeBg.setCornerRadius(dp(999));
        badgeView.setBackground(badgeBg);
        LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        badgeParams.setMarginStart(dp(8));
        titleWrap.addView(badgeView, badgeParams);

        LinearLayout.LayoutParams titleWrapParams = new LinearLayout.LayoutParams(
                0,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                1f
        );
        headerRow.addView(titleWrap, titleWrapParams);

        TextView expandBtn = createCircleIconButton("↗", COLOR_SURFACE, COLOR_TEXT_PRIMARY, 16);
        expandBtn.setContentDescription("Open full Kevin AI app");
        expandBtn.setOnClickListener(v -> openFullApp());
        LinearLayout.LayoutParams expandParams = new LinearLayout.LayoutParams(dp(34), dp(34));
        expandParams.setMarginEnd(dp(8));
        headerRow.addView(expandBtn, expandParams);

        TextView closeBtn = createCircleIconButton("✕", COLOR_SURFACE, COLOR_TEXT_SECONDARY, 14);
        closeBtn.setContentDescription("Close assistant");
        closeBtn.setOnClickListener(v -> dismissOverlay());
        headerRow.addView(closeBtn, new LinearLayout.LayoutParams(dp(34), dp(34)));

        cardContainer.addView(headerRow);

        // 2. Live Screen Vision Preview Bar (visible when behind-screen or live screen frame is present)
        liveScreenRow = new LinearLayout(this);
        liveScreenRow.setOrientation(LinearLayout.HORIZONTAL);
        liveScreenRow.setGravity(Gravity.CENTER_VERTICAL);
        liveScreenRow.setVisibility(View.GONE);
        liveScreenRow.setPadding(dp(8), dp(7), dp(8), dp(7));
        GradientDrawable liveBg = new GradientDrawable();
        liveBg.setColor(Color.parseColor("#102A23"));
        liveBg.setCornerRadius(dp(16));
        liveBg.setStroke(dp(1), COLOR_EMERALD);
        liveScreenRow.setBackground(liveBg);
        LinearLayout.LayoutParams liveRowParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        liveRowParams.bottomMargin = dp(8);

        liveScreenThumb = new ImageView(this);
        liveScreenThumb.setScaleType(ImageView.ScaleType.CENTER_CROP);
        GradientDrawable thumbBg = new GradientDrawable();
        thumbBg.setColor(Color.BLACK);
        thumbBg.setCornerRadius(dp(8));
        liveScreenThumb.setBackground(thumbBg);
        LinearLayout.LayoutParams liveThumbParams = new LinearLayout.LayoutParams(dp(42), dp(42));
        liveThumbParams.setMarginEnd(dp(10));
        liveScreenRow.addView(liveScreenThumb, liveThumbParams);

        LinearLayout liveTextCol = new LinearLayout(this);
        liveTextCol.setOrientation(LinearLayout.VERTICAL);

        liveScreenTitle = new TextView(this);
        liveScreenTitle.setText("👁 Screen yafashwe");
        liveScreenTitle.setTextColor(COLOR_EMERALD_GLOW);
        liveScreenTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
        liveScreenTitle.setTypeface(Typeface.DEFAULT_BOLD);
        liveTextCol.addView(liveScreenTitle);

        liveScreenSubtitle = new TextView(this);
        liveScreenSubtitle.setText("Kevin AI ireba ibiri kuri screen yawe");
        liveScreenSubtitle.setTextColor(COLOR_TEXT_SECONDARY);
        liveScreenSubtitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        liveTextCol.addView(liveScreenSubtitle);

        liveScreenRow.addView(liveTextCol, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        explainScreenBtn = new TextView(this);
        explainScreenBtn.setText("Sobanura");
        explainScreenBtn.setTextColor(Color.WHITE);
        explainScreenBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f);
        explainScreenBtn.setTypeface(Typeface.DEFAULT_BOLD);
        explainScreenBtn.setPadding(dp(10), dp(6), dp(10), dp(6));
        explainScreenBtn.setClickable(true);
        explainScreenBtn.setFocusable(true);
        GradientDrawable expBg = new GradientDrawable();
        expBg.setColor(COLOR_EMERALD);
        expBg.setCornerRadius(dp(999));
        explainScreenBtn.setBackground(expBg);
        explainScreenBtn.setOnClickListener(v -> explainCurrentScreenAutomatically());
        LinearLayout.LayoutParams expParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        expParams.setMarginEnd(dp(6));
        liveScreenRow.addView(explainScreenBtn, expParams);

        TextView clearScreenBtn = createCircleIconButton("✕", Color.parseColor("#1D3831"), COLOR_TEXT_PRIMARY, 11);
        clearScreenBtn.setClickable(true);
        clearScreenBtn.setFocusable(true);
        clearScreenBtn.setOnClickListener(v -> {
            if (isLiveScreenSharing) {
                stopLiveScreenCapture();
            } else {
                latestScreenFrameBase64 = null;
                liveScreenRow.setVisibility(View.GONE);
            }
        });
        liveScreenRow.addView(clearScreenBtn, new LinearLayout.LayoutParams(dp(26), dp(26)));

        cardContainer.addView(liveScreenRow, liveRowParams);

        // 3. Response & Action Panel (visible when active)
        responsePanel = new LinearLayout(this);
        responsePanel.setOrientation(LinearLayout.VERTICAL);
        responsePanel.setVisibility(View.GONE);
        GradientDrawable respBg = new GradientDrawable();
        respBg.setColor(Color.parseColor("#0B141A"));
        respBg.setCornerRadius(dp(18));
        respBg.setStroke(dp(1), Color.parseColor("#1D2E36"));
        responsePanel.setBackground(respBg);
        responsePanel.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams respPanelParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        respPanelParams.bottomMargin = dp(10);

        submittedPromptView = new TextView(this);
        submittedPromptView.setTextColor(COLOR_EMERALD_GLOW);
        submittedPromptView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        submittedPromptView.setTypeface(Typeface.DEFAULT_BOLD);
        submittedPromptView.setPadding(0, 0, 0, dp(4));
        responsePanel.addView(submittedPromptView);

        responseScroll = new ScrollView(this) {
            @Override
            protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
                int maxH = MeasureSpec.makeMeasureSpec(dp(185), MeasureSpec.AT_MOST);
                super.onMeasure(widthMeasureSpec, maxH);
            }
        };
        LinearLayout scrollInner = new LinearLayout(this);
        scrollInner.setOrientation(LinearLayout.VERTICAL);

        loadingSpinner = new ProgressBar(this);
        loadingSpinner.setVisibility(View.GONE);
        LinearLayout.LayoutParams spinParams = new LinearLayout.LayoutParams(dp(24), dp(24));
        spinParams.bottomMargin = dp(6);
        scrollInner.addView(loadingSpinner, spinParams);

        replyTextView = new TextView(this);
        replyTextView.setTextColor(COLOR_TEXT_PRIMARY);
        replyTextView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        replyTextView.setLineSpacing(dp(3), 1f);
        replyTextView.setTextIsSelectable(true);
        scrollInner.addView(replyTextView);

        actionStatusBadge = new TextView(this);
        actionStatusBadge.setVisibility(View.GONE);
        actionStatusBadge.setTextColor(Color.parseColor("#D1FAE5"));
        actionStatusBadge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
        actionStatusBadge.setTypeface(Typeface.DEFAULT_BOLD);
        actionStatusBadge.setPadding(dp(10), dp(7), dp(10), dp(7));
        GradientDrawable actBg = new GradientDrawable();
        actBg.setColor(Color.parseColor("#12392F"));
        actBg.setCornerRadius(dp(12));
        actBg.setStroke(dp(1), COLOR_EMERALD);
        actionStatusBadge.setBackground(actBg);
        LinearLayout.LayoutParams actParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        actParams.topMargin = dp(8);
        scrollInner.addView(actionStatusBadge, actParams);

        contactChoicesLayout = new LinearLayout(this);
        contactChoicesLayout.setOrientation(LinearLayout.VERTICAL);
        contactChoicesLayout.setVisibility(View.GONE);
        LinearLayout.LayoutParams choicesParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        choicesParams.topMargin = dp(8);
        scrollInner.addView(contactChoicesLayout, choicesParams);

        permissionActionBtn = new TextView(this);
        permissionActionBtn.setVisibility(View.GONE);
        permissionActionBtn.setText("🔓 Emeza uburenganzira (Call / SMS / Contacts)");
        permissionActionBtn.setTextColor(Color.WHITE);
        permissionActionBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        permissionActionBtn.setTypeface(Typeface.DEFAULT_BOLD);
        permissionActionBtn.setGravity(Gravity.CENTER);
        permissionActionBtn.setPadding(dp(12), dp(9), dp(12), dp(9));
        GradientDrawable permBg = new GradientDrawable();
        permBg.setColor(COLOR_EMERALD);
        permBg.setCornerRadius(dp(12));
        permissionActionBtn.setBackground(permBg);
        LinearLayout.LayoutParams permParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        permParams.topMargin = dp(8);
        permissionActionBtn.setOnClickListener(v -> agentBridge.requestAgentPermissions());
        scrollInner.addView(permissionActionBtn, permParams);

        responseScroll.addView(scrollInner);
        responsePanel.addView(responseScroll);
        cardContainer.addView(responsePanel, respPanelParams);

        // 4. Attached Photo Preview Row (hidden until photo selected)
        attachmentPreviewRow = new LinearLayout(this);
        attachmentPreviewRow.setOrientation(LinearLayout.HORIZONTAL);
        attachmentPreviewRow.setGravity(Gravity.CENTER_VERTICAL);
        attachmentPreviewRow.setVisibility(View.GONE);
        attachmentPreviewRow.setPadding(dp(8), dp(6), dp(8), dp(6));
        GradientDrawable attachBg = new GradientDrawable();
        attachBg.setColor(COLOR_SURFACE);
        attachBg.setCornerRadius(dp(14));
        attachmentPreviewRow.setBackground(attachBg);
        LinearLayout.LayoutParams attachRowParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        attachRowParams.bottomMargin = dp(8);

        attachmentThumb = new ImageView(this);
        attachmentThumb.setScaleType(ImageView.ScaleType.CENTER_CROP);
        LinearLayout.LayoutParams thumbParams = new LinearLayout.LayoutParams(dp(42), dp(42));
        thumbParams.setMarginEnd(dp(10));
        attachmentPreviewRow.addView(attachmentThumb, thumbParams);

        TextView attachLabel = new TextView(this);
        attachLabel.setText("Ifoto yatoranyijwe — andika icyo uyibazaho");
        attachLabel.setTextColor(COLOR_TEXT_PRIMARY);
        attachLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
        attachmentPreviewRow.addView(attachLabel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView removeAttachBtn = createCircleIconButton("✕", Color.parseColor("#2A3B44"), COLOR_TEXT_PRIMARY, 12);
        removeAttachBtn.setOnClickListener(v -> clearAttachedImage());
        attachmentPreviewRow.addView(removeAttachBtn, new LinearLayout.LayoutParams(dp(28), dp(28)));

        cardContainer.addView(attachmentPreviewRow, attachRowParams);

        // 5. Prompt EditText
        promptInput = new EditText(this);
        promptInput.setBackground(null);
        promptInput.setHint("Andika, vuga, cyangwa ubaze ibiri kuri screen...");
        promptInput.setHintTextColor(COLOR_TEXT_SECONDARY);
        promptInput.setTextColor(COLOR_TEXT_PRIMARY);
        promptInput.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        promptInput.setMinLines(2);
        promptInput.setMaxLines(4);
        promptInput.setGravity(Gravity.TOP | Gravity.START);
        promptInput.setInputType(InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_FLAG_MULTI_LINE
                | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        promptInput.setImeOptions(EditorInfo.IME_ACTION_SEND);
        promptInput.setPadding(dp(4), dp(2), dp(4), dp(8));
        promptInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                submitCurrentPrompt();
                return true;
            }
            return false;
        });
        cardContainer.addView(promptInput, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        // 6. Gemini-style Live Screen + Quick Agent Chips Row
        HorizontalScrollView chipsScroll = new HorizontalScrollView(this);
        chipsScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout chipsRow = new LinearLayout(this);
        chipsRow.setOrientation(LinearLayout.HORIZONTAL);
        chipsRow.setPadding(0, dp(2), 0, dp(10));

        liveToggleChip = createActionChip("📺 Share Live Screen");
        liveToggleChip.setOnClickListener(v -> {
            if (isLiveScreenSharing) {
                stopLiveScreenCapture();
            } else {
                requestLiveScreenShare();
            }
        });
        chipsRow.addView(liveToggleChip);

        autoLiveChip = createActionChip("⚡ Auto Live");
        autoLiveChip.setOnClickListener(v -> {
            boolean next = !KevinAgentPrefs.isAutoLiveScreenOnHome(this);
            KevinAgentPrefs.setAutoLiveScreenOnHome(this, next);
            updateLiveScreenControls();
            if (next && !isLiveScreenSharing) {
                requestLiveScreenShare();
            }
        });
        chipsRow.addView(autoLiveChip);

        chipsRow.addView(createQuickChip("▶ YouTube", "Curanga "));
        chipsRow.addView(createQuickChip("📞 Hamagara", "Hamagara "));
        chipsRow.addView(createQuickChip("💬 SMS", "Ohereza SMS kuri "));
        chipsRow.addView(createQuickChip("💚 WhatsApp", "Ohereza kuri WhatsApp ya "));

        updateLiveScreenControls();
        chipsScroll.addView(chipsRow);
        cardContainer.addView(chipsScroll);

        // 7. Bottom Pill Control Bar (Keyboard | Glowing Emerald Mic | Camera + Send)
        LinearLayout bottomBar = new LinearLayout(this);
        bottomBar.setOrientation(LinearLayout.HORIZONTAL);
        bottomBar.setGravity(Gravity.CENTER_VERTICAL);
        bottomBar.setPadding(0, dp(2), 0, 0);

        View leftSpacer = new View(this);
        bottomBar.addView(leftSpacer, new LinearLayout.LayoutParams(dp(42), dp(1)));

        LinearLayout centerWrap = new LinearLayout(this);
        centerWrap.setGravity(Gravity.CENTER);

        LinearLayout pill = new LinearLayout(this);
        pill.setOrientation(LinearLayout.HORIZONTAL);
        pill.setGravity(Gravity.CENTER_VERTICAL);
        pill.setPadding(dp(10), dp(5), dp(10), dp(5));
        GradientDrawable pillBg = new GradientDrawable();
        pillBg.setColor(COLOR_SURFACE);
        pillBg.setCornerRadius(dp(999));
        pillBg.setStroke(dp(1), COLOR_SURFACE_BORDER);
        pill.setBackground(pillBg);

        TextView keyboardBtn = createCircleIconButton("⌨", Color.TRANSPARENT, COLOR_TEXT_PRIMARY, 18);
        keyboardBtn.setContentDescription("Type command");
        keyboardBtn.setOnClickListener(v -> focusKeyboard());
        pill.addView(keyboardBtn, new LinearLayout.LayoutParams(dp(40), dp(40)));

        micButton = createCircleIconButton("🎤", COLOR_EMERALD, Color.WHITE, 20);
        micButton.setContentDescription("Voice command");
        micButton.setOnClickListener(v -> toggleVoiceRecognition());
        LinearLayout.LayoutParams micParams = new LinearLayout.LayoutParams(dp(46), dp(46));
        micParams.setMargins(dp(10), 0, dp(10), 0);
        pill.addView(micButton, micParams);

        TextView photoBtn = createCircleIconButton("📷", Color.TRANSPARENT, COLOR_TEXT_PRIMARY, 18);
        photoBtn.setContentDescription("Attach photo");
        photoBtn.setOnClickListener(v -> openImagePicker());
        pill.addView(photoBtn, new LinearLayout.LayoutParams(dp(40), dp(40)));

        centerWrap.addView(pill);
        bottomBar.addView(centerWrap, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        sendButton = createCircleIconButton("➤", COLOR_EMERALD, Color.WHITE, 18);
        sendButton.setContentDescription("Send");
        sendButton.setOnClickListener(v -> submitCurrentPrompt());
        bottomBar.addView(sendButton, new LinearLayout.LayoutParams(dp(42), dp(42)));

        cardContainer.addView(bottomBar);

        backdrop.addView(cardContainer, cardParams);
        setContentView(backdrop);

        cardContainer.setTranslationY(dp(90));
        cardContainer.setAlpha(0f);
        cardContainer.animate()
                .translationY(0f)
                .alpha(1f)
                .setDuration(210)
                .start();
    }

    private void updateLiveScreenControls() {
        if (liveToggleChip != null) {
            GradientDrawable bg = new GradientDrawable();
            bg.setCornerRadius(dp(999));
            if (isLiveScreenSharing) {
                liveToggleChip.setText("⏹ Hagarika Live Screen");
                liveToggleChip.setTextColor(Color.WHITE);
                bg.setColor(Color.parseColor("#B91C1C"));
                bg.setStroke(dp(1), Color.parseColor("#EF4444"));
            } else {
                liveToggleChip.setText("📺 Share Live Screen");
                liveToggleChip.setTextColor(COLOR_EMERALD_GLOW);
                bg.setColor(Color.parseColor("#11332B"));
                bg.setStroke(dp(1), COLOR_EMERALD);
            }
            liveToggleChip.setBackground(bg);
        }

        if (autoLiveChip != null) {
            boolean autoOn = KevinAgentPrefs.isAutoLiveScreenOnHome(this);
            GradientDrawable bg = new GradientDrawable();
            bg.setCornerRadius(dp(999));
            if (autoOn) {
                autoLiveChip.setText("⚡ Auto Live: ON");
                autoLiveChip.setTextColor(Color.parseColor("#D1FAE5"));
                bg.setColor(Color.parseColor("#133B30"));
                bg.setStroke(dp(1), COLOR_EMERALD);
            } else {
                autoLiveChip.setText("⚡ Auto Live: OFF");
                autoLiveChip.setTextColor(COLOR_TEXT_SECONDARY);
                bg.setColor(COLOR_SURFACE);
                bg.setStroke(dp(1), COLOR_SURFACE_BORDER);
            }
            autoLiveChip.setBackground(bg);
        }
    }

    private void requestLiveScreenShare() {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            waitingForNotificationPermission = true;
            ActivityCompat.requestPermissions(
                    this,
                    new String[] { Manifest.permission.POST_NOTIFICATIONS },
                    REQ_POST_NOTIFICATIONS
            );
            return;
        }
        launchScreenCapturePermission();
    }

    private void launchScreenCapturePermission() {
        try {
            MediaProjectionManager manager =
                    (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            if (manager == null) {
                showInlineStatus("⚠️ Live screen ntibashije gutangira kuri iki gikoresho.");
                return;
            }
            startActivityForResult(manager.createScreenCaptureIntent(), REQ_SCREEN_CAPTURE);
        } catch (Throwable t) {
            showInlineStatus("⚠️ Ntibyashobotse gufungura Live Screen Share.");
        }
    }

    private void stopLiveScreenCapture() {
        isLiveScreenSharing = false;
        awaitingInitialLiveExplanation = false;
        try {
            Intent stopIntent = new Intent(this, ScreenCaptureService.class)
                    .setAction(ScreenCaptureService.ACTION_STOP);
            startService(stopIntent);
        } catch (Throwable ignored) {}
        updateLiveScreenControls();
        showInlineStatus("⏹ Live Screen Share yahagaze.");
    }

    private TextView createCircleIconButton(String label, int bgColor, int textColor, int textSizeSp) {
        TextView btn = new TextView(this);
        btn.setText(label);
        btn.setTextColor(textColor);
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, textSizeSp);
        btn.setGravity(Gravity.CENTER);
        if (bgColor != Color.TRANSPARENT) {
            GradientDrawable circle = new GradientDrawable();
            circle.setShape(GradientDrawable.OVAL);
            circle.setColor(bgColor);
            btn.setBackground(circle);
        }
        return btn;
    }

    private TextView createActionChip(String label) {
        TextView chip = new TextView(this);
        chip.setText(label);
        chip.setTextColor(COLOR_TEXT_PRIMARY);
        chip.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
        chip.setTypeface(Typeface.DEFAULT_BOLD);
        chip.setPadding(dp(12), dp(7), dp(12), dp(7));
        chip.setClickable(true);
        chip.setFocusable(true);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.setMarginEnd(dp(8));
        chip.setLayoutParams(params);
        return chip;
    }

    private TextView createQuickChip(String label, String starterPrefix) {
        TextView chip = new TextView(this);
        chip.setText(label);
        chip.setTextColor(COLOR_TEXT_PRIMARY);
        chip.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
        chip.setPadding(dp(12), dp(7), dp(12), dp(7));
        chip.setClickable(true);
        chip.setFocusable(true);
        GradientDrawable chipBg = new GradientDrawable();
        chipBg.setColor(COLOR_SURFACE);
        chipBg.setCornerRadius(dp(999));
        chipBg.setStroke(dp(1), COLOR_SURFACE_BORDER);
        chip.setBackground(chipBg);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.setMarginEnd(dp(8));
        chip.setLayoutParams(params);
        chip.setOnClickListener(v -> {
            promptInput.setText(starterPrefix);
            promptInput.setSelection(starterPrefix.length());
            focusKeyboard();
        });
        return chip;
    }

    private void focusKeyboard() {
        if (promptInput == null) return;
        promptInput.requestFocus();
        try {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null) {
                imm.showSoftInput(promptInput, InputMethodManager.SHOW_IMPLICIT);
            }
        } catch (Throwable ignored) {}
    }

    private void hideKeyboard() {
        try {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null && promptInput != null) {
                imm.hideSoftInputFromWindow(promptInput.getWindowToken(), 0);
            }
        } catch (Throwable ignored) {}
    }

    private void openImagePicker() {
        try {
            Intent pickIntent = new Intent(Intent.ACTION_GET_CONTENT);
            pickIntent.setType("image/*");
            Intent cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            Intent chooser = Intent.createChooser(pickIntent, "Hitamo ifoto cyangwa Kamera");
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { cameraIntent });
            startActivityForResult(chooser, REQ_PICK_IMAGE);
        } catch (Throwable t) {
            try {
                Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                startActivityForResult(cam, REQ_CAMERA_CAPTURE);
            } catch (Throwable ignored) {}
        }
    }

    private void clearAttachedImage() {
        pendingImageBase64 = null;
        if (attachmentPreviewRow != null) {
            attachmentPreviewRow.setVisibility(View.GONE);
        }
        if (attachmentThumb != null) {
            attachmentThumb.setImageDrawable(null);
        }
    }

    private void toggleVoiceRecognition() {
        if (isListening) {
            stopListening();
            return;
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[] { Manifest.permission.RECORD_AUDIO },
                    REQ_RECORD_AUDIO
            );
            return;
        }
        startSpeechRecognition();
    }

    private void startSpeechRecognition() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            launchSpeechIntentFallback();
            return;
        }
        try {
            if (speechRecognizer != null) {
                speechRecognizer.destroy();
                speechRecognizer = null;
            }
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
            speechRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override
                public void onReadyForSpeech(Bundle params) {
                    setListeningUi(true);
                    promptInput.setHint("🎤 Ndateze amatwi... vuga ubu");
                }

                @Override
                public void onBeginningOfSpeech() {}

                @Override
                public void onRmsChanged(float rmsdB) {}

                @Override
                public void onBufferReceived(byte[] buffer) {}

                @Override
                public void onEndOfSpeech() {
                    setListeningUi(false);
                }

                @Override
                public void onError(int error) {
                    setListeningUi(false);
                    promptInput.setHint("Andika, vuga, cyangwa ubaze ibiri kuri screen...");
                    if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                        showInlineStatus("⚠️ Ntabwo numvise ijwi neza, ongera ugerageze.");
                    }
                }

                @Override
                public void onResults(Bundle results) {
                    setListeningUi(false);
                    promptInput.setHint("Andika, vuga, cyangwa ubaze ibiri kuri screen...");
                    ArrayList<String> matches = results != null
                            ? results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            : null;
                    if (matches != null && !matches.isEmpty()) {
                        String spoken = matches.get(0);
                        promptInput.setText(spoken);
                        promptInput.setSelection(spoken.length());
                        submitCurrentPrompt();
                    }
                }

                @Override
                public void onPartialResults(Bundle partialResults) {
                    ArrayList<String> partial = partialResults != null
                            ? partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            : null;
                    if (partial != null && !partial.isEmpty()) {
                        promptInput.setText(partial.get(0));
                        promptInput.setSelection(partial.get(0).length());
                    }
                }

                @Override
                public void onEvent(int eventType, Bundle params) {}
            });

            Intent recogIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            recogIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            recogIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toString());
            recogIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            recogIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);

            setListeningUi(true);
            speechRecognizer.startListening(recogIntent);
        } catch (Throwable t) {
            setListeningUi(false);
            launchSpeechIntentFallback();
        }
    }

    private void launchSpeechIntentFallback() {
        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Vuga icyo ushaka ko Kevin AI ikora...");
            startActivityForResult(intent, REQ_SPEECH_FALLBACK);
        } catch (Throwable t) {
            showInlineStatus("🎤 Koresha microphone yo kuri keyboard cyangwa wandike ubutumwa.");
        }
    }

    private void stopListening() {
        setListeningUi(false);
        try {
            if (speechRecognizer != null) {
                speechRecognizer.stopListening();
            }
        } catch (Throwable ignored) {}
    }

    private void setListeningUi(boolean listening) {
        isListening = listening;
        if (micButton == null) return;
        GradientDrawable micBg = new GradientDrawable();
        micBg.setShape(GradientDrawable.OVAL);
        micBg.setColor(listening ? Color.parseColor("#EF4444") : COLOR_EMERALD);
        micButton.setBackground(micBg);
        micButton.setText(listening ? "■" : "🎤");
    }

    private void submitCurrentPrompt() {
        if (isSending) return;
        String prompt = promptInput != null ? promptInput.getText().toString().trim() : "";
        String effectiveImageB64 = !TextUtils.isEmpty(pendingImageBase64)
                ? pendingImageBase64
                : latestScreenFrameBase64;
        String effectiveMime = !TextUtils.isEmpty(pendingImageBase64)
                ? pendingImageMimeType
                : "image/jpeg";

        if (TextUtils.isEmpty(prompt) && TextUtils.isEmpty(effectiveImageB64)) {
            return;
        }
        hideKeyboard();

        final String finalPrompt = !TextUtils.isEmpty(prompt)
                ? prompt
                : "Reba iyi screen cyangwa ifoto, usobanure neza ibiriho.";

        if (promptInput != null) promptInput.setText("");
        clearAttachedImage();

        prepareResponseUi(finalPrompt);
        isSending = true;

        String backendUrl = KevinAgentPrefs.getEffectiveBackendBaseUrl(this);
        if (isDirectDeviceCommandFastPath(finalPrompt)) {
            if (tryExecuteLocalAgentCommand(finalPrompt, backendUrl)) {
                isSending = false;
                loadingSpinner.setVisibility(View.GONE);
                return;
            }
        }

        if (!TextUtils.isEmpty(backendUrl)) {
            streamFromBackend(backendUrl, finalPrompt, effectiveImageB64, effectiveMime);
        } else {
            if (!tryExecuteLocalAgentCommand(finalPrompt, "")) {
                replyTextView.setText("Ntabwo server ya Kevin AI yabashije kuboneka ubu.");
            }
            isSending = false;
            loadingSpinner.setVisibility(View.GONE);
        }
    }

    private boolean isDirectDeviceCommandFastPath(String prompt) {
        String lower = prompt.toLowerCase(Locale.ROOT);
        return lower.startsWith("hamagara ")
                || lower.startsWith("call ")
                || lower.startsWith("terefone ")
                || lower.startsWith("dial ");
    }

    private void prepareResponseUi(String prompt) {
        responsePanel.setVisibility(View.VISIBLE);
        submittedPromptView.setText("Wowe: " + prompt);
        replyTextView.setText("");
        loadingSpinner.setVisibility(View.VISIBLE);
        actionStatusBadge.setVisibility(View.GONE);
        contactChoicesLayout.setVisibility(View.GONE);
        contactChoicesLayout.removeAllViews();
        permissionActionBtn.setVisibility(View.GONE);
        pendingActionType = null;
        pendingActionMessage = null;
    }

    private void showInlineStatus(String msg) {
        responsePanel.setVisibility(View.VISIBLE);
        actionStatusBadge.setVisibility(View.VISIBLE);
        actionStatusBadge.setText(msg);
    }

    private void streamFromBackend(String backendUrl, String prompt, String imageB64, String imageMime) {
        executor.execute(() -> {
            HttpURLConnection conn = null;
            final StringBuilder accumulatedText = new StringBuilder();
            boolean gotAction = false;
            try {
                URL url = new URL(backendUrl + "/api/chat");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(12_000);
                conn.setReadTimeout(45_000);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);

                JSONArray parts = new JSONArray();
                parts.put(new JSONObject().put("text", prompt));
                if (!TextUtils.isEmpty(imageB64)) {
                    parts.put(new JSONObject().put("inlineData", new JSONObject()
                            .put("mimeType", TextUtils.isEmpty(imageMime) ? "image/jpeg" : imageMime)
                            .put("data", imageB64)));
                }
                JSONArray contents = new JSONArray()
                        .put(new JSONObject().put("role", "user").put("parts", parts));

                JSONObject permsObj = new JSONObject();
                permsObj.put("autoSend", true);
                permsObj.put("autoCall", true);
                permsObj.put("autoPlayYouTube", true);
                permsObj.put("whatsappAutoReply", KevinAgentPrefs.isWhatsAppAutoReplyEnabled(this));

                JSONArray contactsArr = new JSONArray();
                try {
                    contactsArr = new JSONArray(agentBridge.lookupContactsJson(""));
                    if (contactsArr.length() > 40) {
                        JSONArray trimmed = new JSONArray();
                        for (int i = 0; i < 40; i++) trimmed.put(contactsArr.get(i));
                        contactsArr = trimmed;
                    }
                } catch (Throwable ignored) {}

                JSONObject payload = new JSONObject();
                payload.put("contents", contents);
                payload.put("userName", KevinAgentPrefs.getUserName(this));
                payload.put("selectedModel", "Kevin pro");
                payload.put("agentPermissions", permsObj);
                payload.put("savedContacts", contactsArr);

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload.toString().getBytes(StandardCharsets.UTF_8));
                }

                int status = conn.getResponseCode();
                if (status < 200 || status >= 300) {
                    throw new Exception("HTTP " + status);
                }

                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        String trimmed = line.trim();
                        if (trimmed.isEmpty()) continue;
                        try {
                            JSONObject evt = new JSONObject(trimmed);
                            String type = evt.optString("type");
                            if ("text".equals(type)) {
                                String chunk = evt.optString("text", "");
                                if (!chunk.isEmpty()) {
                                    accumulatedText.append(chunk);
                                    String snapshot = accumulatedText.toString();
                                    mainHandler.post(() -> {
                                        if (isFinishing() || isDestroyed()) return;
                                        replyTextView.setText(snapshot);
                                        responseScroll.post(() -> responseScroll.fullScroll(View.FOCUS_DOWN));
                                    });
                                }
                            } else if ("action".equals(type)) {
                                gotAction = true;
                                String actionName = evt.optString("name");
                                JSONObject args = evt.optJSONObject("args");
                                if (args == null) args = new JSONObject();
                                final JSONObject finalArgs = args;
                                mainHandler.post(() -> {
                                    if (isFinishing() || isDestroyed()) return;
                                    executeServerAction(actionName, finalArgs);
                                });
                            } else if ("error".equals(type)) {
                                String err = evt.optString("error", "Habaye ikibazo.");
                                mainHandler.post(() -> {
                                    if (!isFinishing() && !isDestroyed()) {
                                        replyTextView.setText(err);
                                    }
                                });
                            }
                        } catch (Throwable ignored) {}
                    }
                }

                final boolean anyAction = gotAction;
                mainHandler.post(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    isSending = false;
                    loadingSpinner.setVisibility(View.GONE);
                    if (accumulatedText.length() == 0 && !anyAction) {
                        tryExecuteLocalAgentCommand(prompt, "");
                    }
                });
            } catch (Throwable err) {
                mainHandler.post(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    isSending = false;
                    loadingSpinner.setVisibility(View.GONE);
                    if (!tryExecuteLocalAgentCommand(prompt, "")) {
                        replyTextView.setText("Ntabwo nshoboye kuvugana na server ubu. Nyamuneka reba internet cyangwa wongere ugerageze.");
                    }
                });
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private void executeServerAction(String name, JSONObject args) {
        if ("open_youtube".equals(name)) {
            String videoId = args.optString("videoId", "");
            String query = args.optString("query", "");
            String title = args.optString("videoTitle", query);
            agentBridge.playYouTube(videoId, query);
            showInlineStatus("▶ Ari gucuranga kuri YouTube: " + title);
        } else if ("make_call".equals(name)) {
            String phone = args.optString("phone_number", "");
            String contactName = args.optString("contact_name", "");
            handleCallAction(phone, contactName);
        } else if ("send_sms".equals(name)) {
            String phone = args.optString("phone_number", "");
            String contactName = args.optString("contact_name", "");
            String message = args.optString("message", "");
            handleSmsAction(phone, contactName, message);
        } else if ("open_whatsapp".equals(name)) {
            String phone = args.optString("phone_number", "");
            String contactName = args.optString("contact_name", "");
            String message = args.optString("message", "");
            handleWhatsAppAction(phone, contactName, message);
        } else if ("open_camera".equals(name)) {
            launchDeviceCamera();
        } else if ("open_audiomack".equals(name)) {
            String query = args.optString("query", "");
            openExternalUrl("https://audiomack.com/search?q=" + Uri.encode(query), "🎵 Ari gufungura Audiomack: " + query);
        } else if ("open_lark_player".equals(name)) {
            launchPackageOrToast("com.gemini.larkplayer", "🎶 Ari gufungura Lark Player");
        } else if ("open_app".equals(name)) {
            String appName = args.optString("app_name", "");
            launchAppByName(appName);
        }
    }

    private boolean tryExecuteLocalAgentCommand(String prompt, String backendUrl) {
        String lower = prompt.trim().toLowerCase(Locale.ROOT);

        if (lower.matches("^(hamagara|terefone|telephona|call|dial|ring|mpamagarira)\\b.*")) {
            String rest = prompt.replaceFirst("(?i)^(hamagara|terefone|telephona|call|dial|ring|mpamagarira)\\s+", "").trim();
            String digits = extractPhoneNumber(rest);
            if (!TextUtils.isEmpty(digits)) {
                handleCallAction(digits, "");
            } else {
                handleCallAction("", rest);
            }
            return true;
        }

        if (lower.contains("whatsapp") || lower.contains("watsap")) {
            ParsedMessage parsed = parseRecipientAndMessage(prompt, "(?i).*?(whatsapp|watsap)\\s*(ya|kuri|to|kwa)?\\s*");
            handleWhatsAppAction(parsed.phone, parsed.contactName, parsed.message);
            return true;
        }

        if (lower.contains("sms") || lower.startsWith("ohereza ubutumwa") || lower.startsWith("send text") || lower.startsWith("andikira")) {
            ParsedMessage parsed = parseRecipientAndMessage(prompt, "(?i)^(?:ohereza|send|andikira)\\s*(?:ubutumwa|sms|text|message)?\\s*(?:kuri|to|ya)?\\s*");
            handleSmsAction(parsed.phone, parsed.contactName, parsed.message);
            return true;
        }

        if (lower.contains("youtube") || lower.startsWith("curanga ") || lower.startsWith("play ")) {
            String songQuery = prompt
                    .replaceAll("(?i)\\b(fungura|kuri|open|on|youtube|un?curangire|curanga|play|indirimbo|song|video)\\b", " ")
                    .replaceAll("\\s+", " ")
                    .trim();
            if (TextUtils.isEmpty(songQuery)) songQuery = prompt;
            final String finalQuery = songQuery;
            if (!TextUtils.isEmpty(backendUrl)) {
                resolveYouTubeAndPlay(backendUrl, finalQuery);
            } else {
                agentBridge.playYouTube("", finalQuery);
                replyTextView.setText("Ari gucuranga \"" + finalQuery + "\" kuri YouTube...");
                showInlineStatus("▶ YouTube ifunguwe: " + finalQuery);
            }
            return true;
        }

        if (lower.contains("camera") || lower.contains("kamera")) {
            launchDeviceCamera();
            return true;
        }

        return false;
    }

    private void resolveYouTubeAndPlay(String backendUrl, String query) {
        loadingSpinner.setVisibility(View.VISIBLE);
        executor.execute(() -> {
            String videoId = "";
            String title = query;
            HttpURLConnection conn = null;
            try {
                URL url = new URL(backendUrl + "/api/youtube/resolve?q=" + URLEncoder.encode(query, "UTF-8"));
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(8000);
                if (conn.getResponseCode() == 200) {
                    StringBuilder sb = new StringBuilder();
                    try (BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                        String l;
                        while ((l = r.readLine()) != null) sb.append(l);
                    }
                    JSONObject obj = new JSONObject(sb.toString());
                    videoId = obj.optString("videoId", "");
                    title = obj.optString("title", query);
                }
            } catch (Throwable ignored) {
            } finally {
                if (conn != null) conn.disconnect();
            }

            final String finalVideoId = videoId;
            final String finalTitle = title;
            mainHandler.post(() -> {
                if (isFinishing() || isDestroyed()) return;
                loadingSpinner.setVisibility(View.GONE);
                agentBridge.playYouTube(finalVideoId, query);
                replyTextView.setText("▶ Ari gucuranga: " + finalTitle);
                showInlineStatus("▶ YouTube Auto-Play: " + finalTitle);
            });
        });
    }

    private void handleCallAction(String phone, String contactName) {
        if (!TextUtils.isEmpty(phone)) {
            String result = agentBridge.placeCall(phone);
            String label = !TextUtils.isEmpty(contactName) ? contactName + " (" + phone + ")" : phone;
            if ("called".equals(result)) {
                replyTextView.setText("Ari guhamagara " + label + " ako kanya...");
                showInlineStatus("📞 Ari guhamagara " + label);
            } else {
                replyTextView.setText("Dialer ifunguwe kuri " + label + ". Emeza CALL_PHONE kugira ngo ahite ahamagara atarinze gusaba.");
                showInlineStatus("📞 Dialer ifunguwe: " + label);
                permissionActionBtn.setVisibility(View.VISIBLE);
            }
            return;
        }

        List<ContactEntry> matches = findContacts(contactName);
        if (matches.size() == 1) {
            ContactEntry match = matches.get(0);
            handleCallAction(match.phone, match.name);
        } else if (matches.size() > 1) {
            pendingActionType = "call";
            replyTextView.setText("Hari contacts nyinshi zitwa \"" + contactName + "\". Hitamo iyo uhamagara:");
            showContactChoices(matches);
        } else {
            boolean hasContactsPerm = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS)
                    == PackageManager.PERMISSION_GRANTED;
            if (!hasContactsPerm) {
                replyTextView.setText("Nkeneye uburenganzira bwa Contacts kugira ngo nshake \"" + contactName + "\".");
                permissionActionBtn.setVisibility(View.VISIBLE);
            } else {
                replyTextView.setText("Sinabonye contact yitwa \"" + contactName + "\" muri telefone yawe.");
            }
        }
    }

    private void handleSmsAction(String phone, String contactName, String message) {
        if (!TextUtils.isEmpty(phone)) {
            if (TextUtils.isEmpty(message)) {
                replyTextView.setText("Andika ubutumwa ushaka kohereza kuri " + phone + ".");
                return;
            }
            boolean ok = agentBridge.sendSms(phone, message);
            String label = !TextUtils.isEmpty(contactName) ? contactName + " (" + phone + ")" : phone;
            if (ok) {
                replyTextView.setText("SMS yoherejwe kuri " + label + ":\n\"" + message + "\"");
                showInlineStatus("💬 SMS yoherejwe kuri " + label);
            } else {
                replyTextView.setText("Nkeneye uburenganzira bwa SEND_SMS kugira ngo nohereze ubutumwa ako kanya.");
                permissionActionBtn.setVisibility(View.VISIBLE);
            }
            return;
        }

        List<ContactEntry> matches = findContacts(contactName);
        if (matches.size() == 1) {
            handleSmsAction(matches.get(0).phone, matches.get(0).name, message);
        } else if (matches.size() > 1) {
            pendingActionType = "sms";
            pendingActionMessage = message;
            replyTextView.setText("Hitamo uwo woherezaho SMS:");
            showContactChoices(matches);
        } else {
            boolean hasContactsPerm = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS)
                    == PackageManager.PERMISSION_GRANTED;
            if (!hasContactsPerm) {
                replyTextView.setText("Emeza Contacts & SMS kugira ngo mbashe gushaka \"" + contactName + "\".");
                permissionActionBtn.setVisibility(View.VISIBLE);
            } else {
                replyTextView.setText("Sinabonye nimero ya \"" + contactName + "\".");
            }
        }
    }

    private void handleWhatsAppAction(String phone, String contactName, String message) {
        if (!TextUtils.isEmpty(phone)) {
            agentBridge.sendWhatsApp(phone, message);
            String label = !TextUtils.isEmpty(contactName) ? contactName + " (" + phone + ")" : phone;
            replyTextView.setText("Ari kohereza kuri WhatsApp ya " + label + "...");
            showInlineStatus("💚 WhatsApp ifunguwe kuri " + label);
            return;
        }

        List<ContactEntry> matches = findContacts(contactName);
        if (matches.size() == 1) {
            handleWhatsAppAction(matches.get(0).phone, matches.get(0).name, message);
        } else if (matches.size() > 1) {
            pendingActionType = "whatsapp";
            pendingActionMessage = message;
            replyTextView.setText("Hitamo uwo woherezaho kuri WhatsApp:");
            showContactChoices(matches);
        } else {
            boolean hasContactsPerm = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS)
                    == PackageManager.PERMISSION_GRANTED;
            if (!hasContactsPerm) {
                replyTextView.setText("Emeza Contacts kugira ngo nshake \"" + contactName + "\".");
                permissionActionBtn.setVisibility(View.VISIBLE);
            } else {
                replyTextView.setText("Sinabonye nimero ya \"" + contactName + "\".");
            }
        }
    }

    private void showContactChoices(List<ContactEntry> matches) {
        contactChoicesLayout.removeAllViews();
        contactChoicesLayout.setVisibility(View.VISIBLE);
        int max = Math.min(matches.size(), 5);
        for (int i = 0; i < max; i++) {
            ContactEntry entry = matches.get(i);
            TextView btn = new TextView(this);
            btn.setText("👤 " + entry.name + "  •  " + entry.phone);
            btn.setTextColor(COLOR_TEXT_PRIMARY);
            btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            btn.setPadding(dp(12), dp(9), dp(12), dp(9));
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(COLOR_SURFACE);
            bg.setCornerRadius(dp(12));
            bg.setStroke(dp(1), COLOR_SURFACE_BORDER);
            btn.setBackground(bg);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            );
            lp.bottomMargin = dp(6);
            btn.setLayoutParams(lp);
            btn.setOnClickListener(v -> {
                contactChoicesLayout.setVisibility(View.GONE);
                if ("sms".equals(pendingActionType)) {
                    handleSmsAction(entry.phone, entry.name, pendingActionMessage != null ? pendingActionMessage : "");
                } else if ("whatsapp".equals(pendingActionType)) {
                    handleWhatsAppAction(entry.phone, entry.name, pendingActionMessage != null ? pendingActionMessage : "");
                } else {
                    handleCallAction(entry.phone, entry.name);
                }
            });
            contactChoicesLayout.addView(btn);
        }
    }

    private List<ContactEntry> findContacts(String query) {
        List<ContactEntry> list = new ArrayList<>();
        if (TextUtils.isEmpty(query)) return list;
        try {
            JSONArray arr = new JSONArray(agentBridge.lookupContactsJson(query.trim()));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                list.add(new ContactEntry(o.optString("name"), o.optString("phone")));
            }
        } catch (Throwable ignored) {}
        return list;
    }

    private String extractPhoneNumber(String text) {
        if (TextUtils.isEmpty(text)) return "";
        Matcher m = Pattern.compile("(\\+?\\d[\\d\\s-]{5,}\\d)").matcher(text);
        if (m.find()) {
            return m.group(1).replaceAll("[^\\d+*#]", "");
        }
        return "";
    }

    private ParsedMessage parseRecipientAndMessage(String fullPrompt, String prefixRegex) {
        String stripped = fullPrompt.replaceFirst(prefixRegex, "").trim();
        String phone = extractPhoneNumber(stripped);
        String msg = "";
        String contact = "";

        String[] splitters = new String[] { " ngo ", " ko ", " : ", ": ", " message ", " ubutumwa " };
        int splitIdx = -1;
        String usedSplitter = "";
        String lowerStripped = stripped.toLowerCase(Locale.ROOT);
        for (String sp : splitters) {
            int idx = lowerStripped.indexOf(sp);
            if (idx > 0 && (splitIdx == -1 || idx < splitIdx)) {
                splitIdx = idx;
                usedSplitter = sp;
            }
        }
        if (splitIdx > 0) {
            String left = stripped.substring(0, splitIdx).trim();
            msg = stripped.substring(splitIdx + usedSplitter.length()).trim();
            if (TextUtils.isEmpty(phone)) {
                contact = left;
            }
        } else {
            if (!TextUtils.isEmpty(phone)) {
                msg = stripped.replaceFirst("\\+?\\d[\\d\\s-]{5,}\\d", "").trim();
            } else {
                contact = stripped;
            }
        }
        return new ParsedMessage(phone, contact, msg);
    }

    private void launchDeviceCamera() {
        try {
            Intent cam = new Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA);
            cam.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(cam);
            showInlineStatus("📷 Kamera ifunguwe!");
        } catch (Throwable t) {
            try {
                Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                cam.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(cam);
                showInlineStatus("📷 Kamera ifunguwe!");
            } catch (Throwable ignored) {}
        }
    }

    private void openExternalUrl(String url, String badge) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            showInlineStatus(badge);
        } catch (Throwable ignored) {}
    }

    private void launchPackageOrToast(String pkg, String badge) {
        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage(pkg);
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(launch);
                showInlineStatus(badge);
            }
        } catch (Throwable ignored) {}
    }

    private void launchAppByName(String appName) {
        String lower = appName.toLowerCase(Locale.ROOT);
        if (lower.contains("whatsapp")) {
            launchPackageOrToast("com.whatsapp", "💚 WhatsApp ifunguwe");
        } else if (lower.contains("youtube")) {
            launchPackageOrToast("com.google.android.youtube", "▶ YouTube ifunguwe");
        } else if (lower.contains("audiomack")) {
            launchPackageOrToast("com.audiomack", "🎵 Audiomack ifunguwe");
        } else if (lower.contains("camera")) {
            launchDeviceCamera();
        }
    }

    private void openFullApp() {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(intent);
        } catch (Throwable ignored) {}
        finish();
    }

    private void dismissOverlay() {
        stopListening();
        hideKeyboard();
        finish();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_RECORD_AUDIO) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                startSpeechRecognition();
            } else {
                showInlineStatus("🎤 Emeza uburenganzira bwa Microphone kugira ngo uvuge.");
            }
        } else if (requestCode == REQ_POST_NOTIFICATIONS) {
            boolean shouldContinue = waitingForNotificationPermission;
            waitingForNotificationPermission = false;
            if (shouldContinue && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                launchScreenCapturePermission();
            }
        } else if (requestCode == KevinAgentBridge.AGENT_PERMISSIONS_REQUEST_CODE) {
            if (permissionActionBtn != null) {
                permissionActionBtn.setVisibility(View.GONE);
            }
            showInlineStatus("✅ Uburenganzira bwemejwe! Ongera utange itegeko ryawe.");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_SCREEN_CAPTURE) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                try {
                    awaitingInitialLiveExplanation = true;
                    Intent serviceIntent = new Intent(this, ScreenCaptureService.class)
                            .setAction(ScreenCaptureService.ACTION_START)
                            .putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
                            .putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data);
                    ContextCompat.startForegroundService(this, serviceIntent);
                    isLiveScreenSharing = true;
                    updateLiveScreenControls();
                    showInlineStatus("🟢 Live Screen Share itangiye — ndareba ibiri kuri screen...");
                } catch (Throwable t) {
                    awaitingInitialLiveExplanation = false;
                    showInlineStatus("⚠️ Ntibyashobotse gutangiza Live Screen Service.");
                }
            } else {
                isLiveScreenSharing = false;
                awaitingInitialLiveExplanation = false;
                updateLiveScreenControls();
            }
            return;
        }

        if (resultCode != Activity.RESULT_OK || data == null) return;

        if (requestCode == REQ_SPEECH_FALLBACK) {
            ArrayList<String> matches = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (matches != null && !matches.isEmpty() && promptInput != null) {
                String spoken = matches.get(0);
                promptInput.setText(spoken);
                promptInput.setSelection(spoken.length());
                submitCurrentPrompt();
            }
            return;
        }

        if (requestCode == REQ_PICK_IMAGE || requestCode == REQ_CAMERA_CAPTURE) {
            try {
                Bitmap bitmap = null;
                Uri uri = data.getData();
                if (uri != null) {
                    bitmap = decodeScaledBitmapFromUri(uri, 1024);
                } else if (data.getExtras() != null) {
                    Object raw = data.getExtras().get("data");
                    if (raw instanceof Bitmap) {
                        bitmap = (Bitmap) raw;
                    }
                }
                if (bitmap != null) {
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 82, baos);
                    pendingImageBase64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
                    pendingImageMimeType = "image/jpeg";
                    attachmentThumb.setImageBitmap(bitmap);
                    attachmentPreviewRow.setVisibility(View.VISIBLE);
                }
            } catch (Throwable ignored) {}
        }
    }

    private Bitmap decodeScaledBitmapFromUri(Uri uri, int maxDim) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream is = getContentResolver().openInputStream(uri)) {
            BitmapFactory.decodeStream(is, null, bounds);
        }
        int sample = 1;
        while ((bounds.outWidth / sample) > maxDim || (bounds.outHeight / sample) > maxDim) {
            sample *= 2;
        }
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        try (InputStream is = getContentResolver().openInputStream(uri)) {
            return BitmapFactory.decodeStream(is, null, opts);
        }
    }

    @Override
    protected void onDestroy() {
        try {
            unregisterReceiver(screenVisionReceiver);
        } catch (IllegalArgumentException ignored) {}
        try {
            if (speechRecognizer != null) {
                speechRecognizer.destroy();
                speechRecognizer = null;
            }
        } catch (Throwable ignored) {}
        executor.shutdownNow();
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value,
                getResources().getDisplayMetrics()
        ));
    }

    private static final class ContactEntry {
        final String name;
        final String phone;

        ContactEntry(String name, String phone) {
            this.name = name;
            this.phone = phone;
        }
    }

    private static final class ParsedMessage {
        final String phone;
        final String contactName;
        final String message;

        ParsedMessage(String phone, String contactName, String message) {
            this.phone = phone;
            this.contactName = contactName;
            this.message = message;
        }
    }
}
