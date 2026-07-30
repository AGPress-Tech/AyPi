package it.agpress.aypi.calendar

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import it.agpress.aypi.calendar.ui.AyPiCalendarApp
import it.agpress.aypi.calendar.ui.AyPiTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AyPiTheme {
                val calendarViewModel: CalendarViewModel = viewModel()
                val modulesViewModel: ModulesViewModel = viewModel()
                AyPiCalendarApp(calendarViewModel, modulesViewModel)
            }
        }
    }
}
