package icu.liuhua.workshop;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.MotionEvent;
import android.view.View;

import org.json.JSONArray;
import org.json.JSONObject;

public class FaceView extends View {
    public interface Listener {
        void onPick(int index);
        void onMove(int index, int x, int y);
    }

    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private JSONArray nodes = new JSONArray();
    private int selected = -1;
    private Listener listener;
    private float lastX;
    private float lastY;
    private int drag = -1;

    public FaceView(Context context) {
        super(context);
        fill.setColor(0xFFE8F0FE);
        text.setColor(0xFF1C1916);
        text.setTextSize(36f);
        setMinimumHeight(720);
    }

    public void setNodes(JSONArray nodes, int selected) {
        this.nodes = nodes == null ? new JSONArray() : nodes;
        this.selected = selected;
        invalidate();
    }

    public void setListener(Listener listener) {
        this.listener = listener;
    }

    @Override
    protected void onDraw(Canvas canvas) {
        canvas.drawColor(0xFFF5F5F7);
        float scale = Math.min(getWidth(), getHeight()) / 466f;
        for (int i = 0; i < nodes.length(); i++) {
            JSONObject node = nodes.optJSONObject(i);
            if (node == null) continue;
            float left = node.optInt("x") * scale;
            float top = node.optInt("y") * scale;
            float right = left + node.optInt("w") * scale;
            float bottom = top + node.optInt("h") * scale;
            fill.setColor(i == selected ? 0xFFD6E6FF : 0xFFFFFFFF);
            canvas.drawRect(left, top, right, bottom, fill);
            canvas.drawText(node.optString("name", node.optString("type")), left + 8, top + 40, text);
        }
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        float scale = Math.min(getWidth(), Math.max(getHeight(), 1)) / 466f;
        if (scale <= 0) scale = 1f;
        if (event.getAction() == MotionEvent.ACTION_DOWN) {
            drag = hit(event.getX() / scale, event.getY() / scale);
            selected = drag;
            lastX = event.getX();
            lastY = event.getY();
            if (listener != null) listener.onPick(selected);
            invalidate();
            return true;
        }
        if (event.getAction() == MotionEvent.ACTION_MOVE && drag >= 0) {
            JSONObject node = nodes.optJSONObject(drag);
            if (node != null && listener != null) {
                int x = node.optInt("x") + Math.round((event.getX() - lastX) / scale);
                int y = node.optInt("y") + Math.round((event.getY() - lastY) / scale);
                listener.onMove(drag, Math.max(0, x), Math.max(0, y));
            }
            lastX = event.getX();
            lastY = event.getY();
            return true;
        }
        if (event.getAction() == MotionEvent.ACTION_UP) drag = -1;
        return true;
    }

    private int hit(float x, float y) {
        for (int i = nodes.length() - 1; i >= 0; i--) {
            JSONObject node = nodes.optJSONObject(i);
            if (node == null) continue;
            if (x >= node.optInt("x") && y >= node.optInt("y") && x <= node.optInt("x") + node.optInt("w") && y <= node.optInt("y") + node.optInt("h")) {
                return i;
            }
        }
        return -1;
    }
}
