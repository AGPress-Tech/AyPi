package it.agpress.aypi.calendar.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val AyPiColors = lightColorScheme(
    primary = Color(0xFF1368A8),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD5EBFF),
    onPrimaryContainer = Color(0xFF062D4B),
    secondary = Color(0xFF477B9F),
    tertiary = Color(0xFF00A8C8),
    background = Color(0xFFF5F9FC),
    surface = Color.White,
    surfaceVariant = Color(0xFFE8F1F7),
    outline = Color(0xFF91A8B8),
    error = Color(0xFFC62828),
)

@Composable
fun AyPiTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = AyPiColors, content = content)
}
