<script lang="ts">
    import "../app.css";
    import { page } from "$app/state";
    import HeaderTab from "$lib/components/HeaderTab.svelte";
    import { titleize } from "$lib/functions/code";
    import { onMount } from "svelte";
    import { alert } from "$lib/components/Dialog.svelte";

    let { data, children } = $props();
    let { user, session } = data || {};

    let url = $derived(page.url.pathname);
    let isScrolled = $state(false);

    onMount(() => {
        const handleScroll = () => {
            isScrolled = window.scrollY > 0;
        };

        window.addEventListener("scroll", handleScroll);

        return () => {
            window.removeEventListener("scroll", handleScroll);
        };
    });

    $effect(() => {
        if (page.url.searchParams) {
            const urlParams = new URLSearchParams(window.location.search);
            const noPermission = urlParams.get("nopermission");
            if (noPermission) {
                alert("You do not have access to this page.").then(() => null);
            }
        }
    });
</script>

{#if user == null}
    <style>
        .auth {
            display: none;
        }

        .noauth {
            display: block;
        }
    </style>
{:else}
    <style>
        .auth {
            display: block;
        }

        .noauth {
            display: none;
        }
    </style>
{/if}

<header
    class="flex flex-col fixed w-full top-0 z-50 transition-shadow duration-200 {isScrolled
        ? 'shadow-2xl'
        : ''} header-container"
>
    <div
        class="flex items-center justify-center relative p-5 bg-green-400 dark:bg-green-700"
    >
        <div class="text-center w-full font-bold text-xl">
            THE GREEN ALLIANCE
        </div>
        <div class="absolute right-5 bottom-5">
            {#if user != null}
                {titleize(`${user.firstName} ${user.lastName}`)}
            {:else}
                Not logged in
            {/if}
        </div>
    </div>
    <div class="bg-green-300 dark:bg-green-800 nav-wrap">
        <div
            class="flex flex-row flex-nowrap overflow-x-auto nav-strip justify-center"
        >
        <HeaderTab name="Home" href="/" />
        <HeaderTab
            name="Landing"
            href="/"
            custom
            class="{url === '/' && 'current-tab auth block'} hidden"
        />
        <HeaderTab name="Home" href="/home" showOnAuth />
        <HeaderTab name="About" href="/about" />
        <HeaderTab name="Account" href="/account/signin" activeUrl="/account" />
        <HeaderTab name="Account" href="/account" showOnAuth />
        <HeaderTab
            name="Users"
            href="/users"
            showOnAuth
        />
        <HeaderTab
            name="Meetings"
            activeUrl="/meetings"
            showOnAuth
            isDropdown
            elements={[
                { name: "Calendar", url: "/meetings/calendar" },
                { name: "Modify Members/Groups", url: "/users/modify" },
            ]}
        />
        <HeaderTab
            name="Comms"
            activeUrl="/messages"
            showOnAuth
            isDropdown
            elements={[
                { name: "Messages", url: "/messages/chat" },
                data.canAccessAdmin && { name: "Message Log", url: "/messages/admin" },
                { name: "Announcements", url: "/messages/announcements" },
            ].filter(v=>v)}
        />
        </div>
    </div>
</header>
<div class="h-[126px]"></div>
<div class="w-full h-[calc(100vh-126px)]">
    {@render children()}
</div>

<style>

    .nav-strip {
        scrollbar-width: none;
        -ms-overflow-style: none;
    }

    .nav-strip::-webkit-scrollbar {
        display: none;
    }
</style>
