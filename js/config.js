'use strict';

(function initLinclockConfig() {
	// URL base de la API. En GitHub Pages debe apuntar a Supabase Functions.
	// En local, si no se define, se usa window.location.origin desde app.js.
	window.LINCLOCK_API_BASE = 'https://qtyecwfhbxwunmjdtkoa.supabase.co/functions/v1/linclock-api';
})();
