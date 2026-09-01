import { useEffect } from "react";

/**
 * Analytics (GTM, HubSpot, OpenPanel) is disabled in this fork: no external
 * tracking scripts are loaded.
 */
export const Analytics = () => {
	return null;
};

/**
 * The HubSpot script is loaded app-wide for marketing tracking, but the
 * conversations (chat) widget stays restricted to startup plan customers.
 */
export const useHubSpotChat = (enabled: boolean) => {
	useEffect(() => {
		if (!enabled) {
			return;
		}
		const loadWidget = () => {
			window.HubSpotConversations?.widget.load();
		};
		if (window.HubSpotConversations) {
			loadWidget();
		} else {
			window.hsConversationsOnReady = [
				...(window.hsConversationsOnReady || []),
				loadWidget,
			];
		}
	}, [enabled]);
};
