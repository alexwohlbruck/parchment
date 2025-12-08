package app.parchment

import android.content.res.Configuration
import android.os.Build
import android.view.View
import android.view.WindowManager
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Update status bar and navigation bar when theme changes
        updateSystemBars()
    }

    override fun onResume() {
        super.onResume()
        // Ensure status bar is updated when activity resumes
        updateSystemBars()
    }

    private fun updateSystemBars() {
        val window = window ?: return
        val decorView = window.decorView
        
        // Get current night mode
        val isNightMode = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        
        // Update status bar and navigation bar appearance
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            var systemUiVisibility = decorView.systemUiVisibility
            
            if (isNightMode) {
                // Dark mode: use light status bar icons (light text on dark background)
                systemUiVisibility = systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
            } else {
                // Light mode: use dark status bar icons (dark text on light background)
                systemUiVisibility = systemUiVisibility or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            }
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (isNightMode) {
                    // Dark mode: use light navigation bar icons
                    systemUiVisibility = systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
                } else {
                    // Light mode: use dark navigation bar icons
                    systemUiVisibility = systemUiVisibility or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                }
            }
            
            decorView.systemUiVisibility = systemUiVisibility
        }
        
        // Ensure edge-to-edge display
        WindowCompat.setDecorFitsSystemWindows(window, false)
    }
}