"""
SmallCap Signal — Python ML Backend
=====================================
FastAPI service that provides:
  POST /api/predict        — XGBoost-trained directional prediction
  POST /api/analyze        — Full technical snapshot + ML score
  GET  /api/dashboard      — Universe scan (movers, sectors, news)
  POST /api/search         — NSE symbol search
  GET  /api/health         — Health check / model status

Dependencies: see requirements.txt
Run:  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import logging
import os
import time
import warnings
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore", category=FutureWarning)
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("smallcap")

# ─── App setup ────────────────────────────────────────────────────────────────

app = FastAPI(title="SmallCap Signal ML Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Universe (mirrors frontend universe.ts) ──────────────────────────────────

UNIVERSE = [
    # (symbol, name, sector, industry)
    ("SUZLON.NS", "Suzlon Energy", "Renewable Energy", "Wind turbines"),
    ("INOXWIND.NS", "Inox Wind", "Renewable Energy", "Wind turbines"),
    ("WEBELSOLAR.NS", "Websol Energy System", "Renewable Energy", "Solar cells"),
    ("KPIGREEN.NS", "KPI Green Energy", "Renewable Energy", "Solar IPP"),
    ("SWSOLAR.NS", "Sterling & Wilson Solar", "Renewable Energy", "Solar EPC"),
    ("GENSOL.NS", "Gensol Engineering", "Renewable Energy", "Solar EPC"),
    ("SYRMA.NS", "Syrma SGS Technology", "Electronics Manufacturing", "EMS"),
    ("AVALON.NS", "Avalon Technologies", "Electronics Manufacturing", "EMS"),
    ("ELIN.NS", "Elin Electronics", "Electronics Manufacturing", "EMS"),
    ("PGEL.NS", "PG Electroplast", "Electronics Manufacturing", "EMS"),
    ("DIXON.NS", "Dixon Technologies", "Electronics Manufacturing", "EMS"),
    ("AMBER.NS", "Amber Enterprises", "Electronics Manufacturing", "EMS"),
    ("OLECTRA.NS", "Olectra Greentech", "EV & Auto Ancillary", "Electric buses"),
    ("JBMA.NS", "JBM Auto", "EV & Auto Ancillary", "Buses & components"),
    ("GREAVESCOT.NS", "Greaves Cotton", "EV & Auto Ancillary", "Powertrain"),
    ("SANDHAR.NS", "Sandhar Technologies", "EV & Auto Ancillary", "Auto components"),
    ("LUMAXTECH.NS", "Lumax Auto Tech", "EV & Auto Ancillary", "Auto components"),
    ("SALASAR.NS", "Salasar Techno Engg", "Power & Transmission", "Transmission towers"),
    ("KECL.NS", "Kirloskar Electric", "Power & Transmission", "Electrical equipment"),
    ("NBCC.NS", "NBCC India", "Infrastructure", "Construction"),
    ("IRCON.NS", "Ircon International", "Infrastructure", "Railway EPC"),
    ("RVNL.NS", "Rail Vikas Nigam", "Infrastructure", "Railway EPC"),
    ("HCC.NS", "Hindustan Construction", "Infrastructure", "Construction"),
    ("PATELENG.NS", "Patel Engineering", "Infrastructure", "Construction"),
    ("TRIDENT.NS", "Trident", "Textiles & Chemicals", "Textiles"),
    ("GHCL.NS", "GHCL", "Textiles & Chemicals", "Soda ash"),
    ("UJJIVANSFB.NS", "Ujjivan Small Fin Bank", "Financials", "Small finance bank"),
    ("SURYODAY.NS", "Suryoday Small Fin Bank", "Financials", "Small finance bank"),
    ("IOB.NS", "Indian Overseas Bank", "Financials", "PSU bank"),
    ("IDFCFIRSTB.NS", "IDFC First Bank", "Financials", "Private bank"),
]
UNIVERSE_BY_SYMBOL = {u[0]: u for u in UNIVERSE}

# ─── Technical indicators (pure numpy / pandas) ──────────────────────────────

def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(period).mean()

def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()

def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / (loss + 1e-9)
    return 100 - (100 / (1 + rs))

def macd(series: pd.Series):
    fast = ema(series, 12)
    slow = ema(series, 26)
    line = fast - slow
    signal = ema(line, 9)
    hist = line - signal
    return line, signal, hist

def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    hl = df["High"] - df["Low"]
    hc = (df["High"] - df["Close"].shift()).abs()
    lc = (df["Low"] - df["Close"].shift()).abs()
    tr = pd.concat([hl, hc, lc], axis=1).max(axis=1)
    return tr.rolling(period).mean()

def bollinger(series: pd.Series, period: int = 20, k: float = 2.0):
    mid = sma(series, period)
    std = series.rolling(period).std()
    upper = mid + k * std
    lower = mid - k * std
    width = (upper - lower) / (mid + 1e-9)
    return mid, upper, lower, width

def stochastic(df: pd.DataFrame, k_period: int = 14, d_period: int = 3):
    lowest_l = df["Low"].rolling(k_period).min()
    highest_h = df["High"].rolling(k_period).max()
    k = 100 * (df["Close"] - lowest_l) / (highest_h - lowest_l + 1e-9)
    d = k.rolling(d_period).mean()
    return k, d

def williams_r(df: pd.DataFrame, period: int = 14) -> pd.Series:
    highest_h = df["High"].rolling(period).max()
    lowest_l = df["Low"].rolling(period).min()
    return -100 * (highest_h - df["Close"]) / (highest_h - lowest_l + 1e-9)

def obv(df: pd.DataFrame) -> pd.Series:
    direction = np.sign(df["Close"].diff().fillna(0))
    return (direction * df["Volume"]).cumsum()

def vwap(df: pd.DataFrame, period: int = 20) -> pd.Series:
    typical = (df["High"] + df["Low"] + df["Close"]) / 3
    tp_vol = typical * df["Volume"]
    return tp_vol.rolling(period).sum() / df["Volume"].rolling(period).sum()

def adx(df: pd.DataFrame, period: int = 14):
    up_move = df["High"].diff()
    down_move = -df["Low"].diff()
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    atr_v = atr(df, period)
    plus_di = 100 * pd.Series(plus_dm, index=df.index).rolling(period).mean() / (atr_v + 1e-9)
    minus_di = 100 * pd.Series(minus_dm, index=df.index).rolling(period).mean() / (atr_v + 1e-9)
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di + 1e-9)
    adx_v = dx.rolling(period).mean()
    return adx_v, plus_di, minus_di

def ichimoku(df: pd.DataFrame):
    def mid_range(s: pd.DataFrame, p: int):
        return (s["High"].rolling(p).max() + s["Low"].rolling(p).min()) / 2
    tenkan = mid_range(df, 9)
    kijun = mid_range(df, 26)
    senkou_a = ((tenkan + kijun) / 2).shift(26)
    senkou_b = mid_range(df, 52).shift(26)
    chikou = df["Close"].shift(-26)
    return tenkan, kijun, senkou_a, senkou_b, chikou

# ─── Feature engineering ─────────────────────────────────────────────────────

FEATURE_NAMES = [
    "rsi_norm", "macd_norm", "sma20_norm", "sma50_norm", "sma200_norm",
    "stoch_k_norm", "wr_norm", "obv_norm", "vwap_norm", "adx_dir",
    "ichimoku_signal", "mom60_norm", "vol_norm",
    "bb_width_norm", "atr_pct",
]


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Return a DataFrame of normalised feature columns (one row per candle)."""
    close = df["Close"]
    n = len(df)

    r = rsi(close)
    _, _, macd_h = macd(close)
    s20 = sma(close, 20)
    s50 = sma(close, 50)
    s200 = sma(close, 200)
    atr_v = atr(df)
    k, d = stochastic(df)
    wr = williams_r(df)
    obv_v = obv(df)
    obv_sma = sma(obv_v, 20)
    vwap_v = vwap(df)
    adx_v, plus_di, minus_di = adx(df)
    tenkan, kijun, senkou_a, senkou_b, _ = ichimoku(df)
    _, _, _, bb_w = bollinger(close)

    clamp = lambda s: s.clip(-1, 1)

    feat = pd.DataFrame(index=df.index)
    feat["rsi_norm"]       = clamp((r - 50) / 50)
    feat["macd_norm"]      = clamp(macd_h / (atr_v + 1e-9))
    feat["sma20_norm"]     = clamp((close - s20) / (s20 + 1e-9) * 5)
    feat["sma50_norm"]     = clamp((close - s50) / (s50 + 1e-9) * 5)
    feat["sma200_norm"]    = clamp((close - s200) / (s200 + 1e-9) * 5)
    feat["stoch_k_norm"]   = clamp((k - 50) / 50)
    feat["wr_norm"]        = clamp((wr + 50) / 50)
    feat["obv_norm"]       = clamp((obv_v - obv_sma) / (obv_sma.abs() + 1))
    feat["vwap_norm"]      = clamp((close - vwap_v) / (vwap_v + 1e-9) * 20)
    feat["adx_dir"]        = clamp((adx_v * np.where(plus_di > minus_di, 1, -1)) / 50)

    cloud_top = pd.concat([senkou_a, senkou_b], axis=1).max(axis=1)
    cloud_bot = pd.concat([senkou_a, senkou_b], axis=1).min(axis=1)
    ichi_sig = pd.Series(0.0, index=df.index)
    ichi_sig = ichi_sig.where(~((close > cloud_top) & (tenkan > kijun)), 1.0)
    ichi_sig = ichi_sig.where(~((close < cloud_bot) & (tenkan < kijun)), -1.0)
    feat["ichimoku_signal"] = ichi_sig

    mom60 = close.pct_change(60).clip(-0.5, 0.5) * 2
    feat["mom60_norm"] = clamp(mom60)

    avg_vol = df["Volume"].rolling(20).mean()
    feat["vol_norm"]       = clamp(df["Volume"] / (avg_vol + 1) - 1)
    feat["bb_width_norm"]  = clamp(bb_w * 10 - 1)
    feat["atr_pct"]        = clamp(atr_v / (close + 1e-9) * 20 - 1)

    return feat[FEATURE_NAMES]


def build_labels(df: pd.DataFrame, horizon: int = 10, threshold: float = 0.03) -> pd.Series:
    """
    Binary label: 1 = price rises > threshold% over next `horizon` bars,
                  0 = falls or stays flat.
    """
    fwd = df["Close"].shift(-horizon) / df["Close"] - 1
    return (fwd > threshold).astype(int)


# ─── Model registry ───────────────────────────────────────────────────────────

class MLModel:
    """Lazy-trained ensemble model for a single symbol."""

    def __init__(self, symbol: str):
        self.symbol = symbol
        self.pipe: Pipeline | None = None
        self.trained_at: float = 0.0
        self.n_samples: int = 0
        self.feature_importances: dict[str, float] = {}

    def _build_pipeline(self) -> Pipeline:
        return Pipeline([
            ("scaler", StandardScaler()),
            ("clf", GradientBoostingClassifier(
                n_estimators=200,
                max_depth=4,
                learning_rate=0.05,
                subsample=0.8,
                random_state=42,
            )),
        ])

    def train(self, df: pd.DataFrame) -> None:
        feats = build_features(df)
        labels = build_labels(df)
        mask = feats.notna().all(axis=1) & labels.notna()
        # Drop the last 10 rows (future labels unknown)
        mask.iloc[-10:] = False
        X = feats[mask].values
        y = labels[mask].values
        if len(X) < 60:
            raise ValueError(f"Not enough training samples for {self.symbol} ({len(X)})")
        self.pipe = self._build_pipeline()
        self.pipe.fit(X, y)
        self.trained_at = time.time()
        self.n_samples = len(X)
        # Store feature importances from GBM
        clf = self.pipe.named_steps["clf"]
        self.feature_importances = {
            name: round(float(imp), 4)
            for name, imp in zip(FEATURE_NAMES, clf.feature_importances_)
        }
        log.info(f"[model] {self.symbol} trained on {len(X)} samples")

    def predict_proba(self, df: pd.DataFrame) -> tuple[float, float]:
        """Returns (bull_prob, confidence_pct)."""
        if self.pipe is None:
            raise ValueError("Model not trained")
        feats = build_features(df)
        last_row = feats.iloc[[-1]]
        if last_row.isna().any(axis=1).iloc[0]:
            last_row = last_row.fillna(0.0)
        prob = float(self.pipe.predict_proba(last_row)[0][1])
        # Map 0-1 prob to -100..100 score
        score = int((prob - 0.5) * 200)
        confidence = int(40 + abs(prob - 0.5) * 100)
        return score, min(92, confidence)

    def is_stale(self, max_age_h: float = 12.0) -> bool:
        return (time.time() - self.trained_at) > max_age_h * 3600


_model_cache: dict[str, MLModel] = {}


def get_or_train_model(symbol: str, df: pd.DataFrame) -> MLModel:
    m = _model_cache.get(symbol)
    if m is None or m.is_stale():
        m = MLModel(symbol)
        try:
            m.train(df)
        except Exception as e:
            log.warning(f"[model] training failed for {symbol}: {e}")
        _model_cache[symbol] = m
    return m


# ─── Data fetching helpers ────────────────────────────────────────────────────

_df_cache: dict[str, tuple[float, pd.DataFrame]] = {}
DF_TTL = 5 * 60  # 5 minutes


def fetch_df(symbol: str, period: str = "2y", interval: str = "1d") -> pd.DataFrame:
    cache_key = f"{symbol}_{period}_{interval}"
    cached = _df_cache.get(cache_key)
    if cached and (time.time() - cached[0]) < DF_TTL:
        return cached[1]

    ticker = yf.Ticker(symbol)
    df = ticker.history(period=period, interval=interval, auto_adjust=True)
    if df.empty or len(df) < 60:
        raise HTTPException(status_code=404, detail=f"No data found for {symbol}")
    _df_cache[cache_key] = (time.time(), df)
    return df


def fetch_quote_lite(symbol: str, name: str) -> dict[str, Any] | None:
    try:
        df = fetch_df(symbol, period="1mo")
        closes = df["Close"].dropna().tolist()
        if not closes:
            return None
        price = closes[-1]
        prev = closes[-2] if len(closes) > 1 else price
        change_pct = (price - prev) / prev * 100
        spark = closes[-22:] if len(closes) >= 22 else closes
        return {
            "symbol": symbol,
            "name": name,
            "price": round(price, 2),
            "changePct": round(change_pct, 2),
            "volume": int(df["Volume"].iloc[-1]),
            "spark": [round(x, 2) for x in spark],
        }
    except Exception:
        return None


# ─── Core analysis ────────────────────────────────────────────────────────────

def compute_snapshot(df: pd.DataFrame) -> dict[str, Any]:
    """Build a full technical snapshot dict from a price DataFrame."""
    close = df["Close"]
    n = len(df)

    r = rsi(close).iloc[-1]
    _, _, macd_h = macd(close)
    mh = macd_h.iloc[-1]
    s20 = sma(close, 20).iloc[-1]
    s50 = sma(close, 50).iloc[-1]
    s200 = sma(close, 200).iloc[-1] if n >= 200 else None
    atr_v = atr(df).iloc[-1]
    px = float(close.iloc[-1])
    prev = float(close.iloc[-2]) if n > 1 else px
    k, d = stochastic(df)
    wr_v = williams_r(df).iloc[-1]
    obv_v = obv(df)
    obv_sma = sma(obv_v, 20).iloc[-1]
    obv_now = obv_v.iloc[-1]
    vwap_v = vwap(df).iloc[-1]
    adx_v, plus_di, minus_di = adx(df)
    adx_now = adx_v.iloc[-1]
    plus_di_now = plus_di.iloc[-1]
    minus_di_now = minus_di.iloc[-1]
    tenkan, kijun, senkou_a, senkou_b, _ = ichimoku(df)
    _, _, _, bb_w = bollinger(close)

    w60 = df.iloc[-60:]
    support = float(w60["Low"].min())
    resistance = float(w60["High"].max())
    vol20 = float(df["Volume"].iloc[-20:].mean())

    # Ichimoku signal
    sa = senkou_a.iloc[-1] if not pd.isna(senkou_a.iloc[-1]) else None
    sb = senkou_b.iloc[-1] if not pd.isna(senkou_b.iloc[-1]) else None
    ichi_sig = "neutral"
    if sa and sb:
        cloud_top = max(sa, sb)
        cloud_bot = min(sa, sb)
        tn = tenkan.iloc[-1]
        kj = kijun.iloc[-1]
        if not pd.isna(tn) and not pd.isna(kj):
            if px > cloud_top and tn > kj:
                ichi_sig = "bullish"
            elif px < cloud_bot and tn < kj:
                ichi_sig = "bearish"

    # OBV trend
    obv_trend = "flat"
    if not pd.isna(obv_sma) and obv_sma != 0:
        if obv_now > obv_sma * 1.01:
            obv_trend = "up"
        elif obv_now < obv_sma * 0.99:
            obv_trend = "down"

    def pct_chg(k: int) -> float:
        return (px / float(close.iloc[max(0, n - 1 - k)]) - 1) * 100 if n > k else 0.0

    return {
        "price": round(px, 2),
        "changePct1d": round(pct_chg(1), 2),
        "changePct5d": round(pct_chg(5), 2),
        "changePct20d": round(pct_chg(20), 2),
        "changePct60d": round(pct_chg(60), 2),
        "rsi": round(float(r), 1) if not pd.isna(r) else None,
        "sma20": round(float(s20), 2) if not pd.isna(s20) else None,
        "sma50": round(float(s50), 2) if not pd.isna(s50) else None,
        "sma200": round(float(s200), 2) if s200 is not None and not pd.isna(s200) else None,
        "macdHist": round(float(mh), 4) if not pd.isna(mh) else None,
        "atr": round(float(atr_v), 2) if not pd.isna(atr_v) else None,
        "atrPct": round(float(atr_v / px * 100), 2) if not pd.isna(atr_v) else None,
        "volume": int(df["Volume"].iloc[-1]),
        "avgVolume20": round(vol20, 0),
        "high52": round(float(df["High"].iloc[-250:].max()), 2),
        "low52": round(float(df["Low"].iloc[-250:].min()), 2),
        "support": round(support, 2),
        "resistance": round(resistance, 2),
        "stochK": round(float(k.iloc[-1]), 1) if not pd.isna(k.iloc[-1]) else None,
        "stochD": round(float(d.iloc[-1]), 1) if not pd.isna(d.iloc[-1]) else None,
        "williamsR": round(float(wr_v), 1) if not pd.isna(wr_v) else None,
        "adx": round(float(adx_now), 1) if not pd.isna(adx_now) else None,
        "plusDI": round(float(plus_di_now), 1) if not pd.isna(plus_di_now) else None,
        "minusDI": round(float(minus_di_now), 1) if not pd.isna(minus_di_now) else None,
        "obvTrend": obv_trend,
        "vwap": round(float(vwap_v), 2) if not pd.isna(vwap_v) else None,
        "ichimokuSignal": ichi_sig,
        "bbWidth": round(float(bb_w.iloc[-1]), 4) if not pd.isna(bb_w.iloc[-1]) else None,
    }


# ─── Pydantic models ──────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    symbol: str
    capital: float = Field(100_000.0, gt=0)
    profile: str = Field("balanced", pattern="^(conservative|balanced|aggressive)$")
    horizon: str = Field("1-3 months")


class AnalyzeRequest(BaseModel):
    query: str
    capital: float = Field(100_000.0, gt=0)
    profile: str = Field("balanced", pattern="^(conservative|balanced|aggressive)$")
    horizon: str = Field("1-3 months")


class SearchRequest(BaseModel):
    query: str


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "models_cached": len(_model_cache),
        "df_cached": len(_df_cache),
        "timestamp": time.time(),
    }


@app.post("/api/predict")
def predict(req: PredictRequest):
    """
    Run the trained GBM model on the latest features for a symbol and
    return an ML-based directional score, confidence, and feature importances.
    """
    sym = req.symbol.upper()
    if not sym.endswith(".NS") and not sym.endswith(".BO"):
        sym += ".NS"

    try:
        df = fetch_df(sym, period="2y")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    model = get_or_train_model(sym, df)
    if model.pipe is None:
        raise HTTPException(
            status_code=503,
            detail=f"Model training failed for {sym} — insufficient history.",
        )

    score, confidence = model.predict_proba(df)
    direction = "Bullish" if score > 12 else "Bearish" if score < -12 else "Neutral"

    return {
        "symbol": sym,
        "mlScore": score,
        "mlConfidence": confidence,
        "direction": direction,
        "trainedOn": model.n_samples,
        "trainedAt": model.trained_at,
        "featureImportances": model.feature_importances,
    }


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    """
    Full analysis: technical snapshot + ML prediction + candle history.
    """
    query = req.query.strip()

    # Resolve symbol: try universe first, then treat as direct symbol
    entry = next(
        (u for u in UNIVERSE if u[0].replace(".NS", "").lower() == query.lower()
         or u[1].lower() == query.lower() or u[0].lower() == query.lower()),
        None,
    )
    if entry:
        sym, name, sector, industry = entry
    else:
        sym = query.upper()
        if not sym.endswith(".NS") and not sym.endswith(".BO"):
            sym += ".NS"
        name = sym.replace(".NS", "").replace(".BO", "")
        sector = "Other"
        industry = "Other"

    try:
        df = fetch_df(sym, period="2y")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    snapshot = compute_snapshot(df)

    # ML prediction
    model = get_or_train_model(sym, df)
    ml_score, ml_confidence = (0, 50)
    feature_importances: dict[str, float] = {}
    if model.pipe is not None:
        ml_score, ml_confidence = model.predict_proba(df)
        feature_importances = model.feature_importances

    # Blend: 60% ML + 40% rule-based heuristic from features
    feats = build_features(df)
    WEIGHTS = {
        "rsi_norm": 0.10, "macd_norm": 0.09, "sma20_norm": 0.11,
        "sma50_norm": 0.10, "sma200_norm": 0.08, "stoch_k_norm": 0.07,
        "wr_norm": 0.05, "obv_norm": 0.09, "vwap_norm": 0.06,
        "adx_dir": 0.10, "ichimoku_signal": 0.09, "mom60_norm": 0.11,
        "vol_norm": 0.05,
    }
    last_feats = feats.iloc[-1].fillna(0)
    rule_score = int(sum(last_feats.get(k, 0) * w * 100 for k, w in WEIGHTS.items() if k in last_feats.index))
    blended_score = int(ml_score * 0.6 + rule_score * 0.4) if model.pipe else rule_score
    blended_score = max(-100, min(100, blended_score))
    blended_conf = int(ml_confidence * 0.6 + snapshot.get("rsi", 50) * 0.01 * 40) if model.pipe else 50
    blended_conf = max(20, min(92, blended_conf))

    direction = "Bullish" if blended_score > 12 else "Bearish" if blended_score < -12 else "Neutral"

    # Candles (last 260 bars)
    candles = [
        {
            "t": int(row.Index.timestamp()),
            "o": round(float(row.Open), 2),
            "h": round(float(row.High), 2),
            "l": round(float(row.Low), 2),
            "c": round(float(row.Close), 2),
            "v": int(row.Volume),
        }
        for row in df.iloc[-260:].itertuples()
    ]

    return {
        "symbol": sym,
        "name": name,
        "sector": sector,
        "industry": industry,
        "snapshot": {**snapshot, "score": blended_score, "confidence": blended_conf, "direction": direction},
        "mlScore": ml_score,
        "mlConfidence": ml_confidence,
        "ruleScore": rule_score,
        "blendedScore": blended_score,
        "featureImportances": feature_importances,
        "candles": candles,
        "generatedAt": time.time(),
    }


@app.get("/api/dashboard")
def dashboard():
    """Scan the first 20 universe symbols and return movers + sector stats."""
    picks = UNIVERSE[:20]
    results = []
    for sym, name, sector, industry in picks:
        q = fetch_quote_lite(sym, name)
        if q:
            results.append({**q, "sector": sector, "industry": industry})

    by_sector: dict[str, list[float]] = {}
    for r in results:
        by_sector.setdefault(r["sector"], []).append(r["changePct"])

    sectors = sorted(
        [
            {
                "sector": s,
                "avgChange": round(sum(v) / len(v), 2),
                "count": len(v),
            }
            for s, v in by_sector.items()
        ],
        key=lambda x: -x["avgChange"],
    )

    return {
        "movers": results,
        "sectors": sectors,
        "updatedAt": time.time(),
    }


@app.post("/api/search")
def search(req: SearchRequest):
    """Fuzzy-search the universe by name or symbol."""
    q = req.query.strip().lower()
    if not q:
        return []
    hits = [
        {"symbol": u[0], "name": u[1], "sector": u[2], "industry": u[3]}
        for u in UNIVERSE
        if q in u[0].lower() or q in u[1].lower()
    ]
    return hits[:8]


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
