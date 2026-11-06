/*
 * Site content — the only file you need to edit to update the page.
 *
 *  - Every string here is visitor-facing copy. Keep it as approved; do not
 *    add fields or links that have no confirmed answer (leave them out).
 *  - FACTS holds claims whose wording is fixed. Keep the sentences exactly as
 *    agreed and update numbers/dates here only; every section reads from it.
 *  - In paragraphs, **text** becomes bold.
 *  - External links open in a new tab (rel="noopener noreferrer").
 */
(function () {
  'use strict';

  var FACTS = {
    // Date the figures below were last checked. Shown next to them as
    // "As of November 6, 2026".
    asOf: '2026-11-06',

    interviews: '97 interview sessions.',
    waitlist: 'Nearly 200 people on the waitlist.',
    launch: 'Targeting a November 27, 2026 launch.',
    businessTalks: 'Discussions with several potential business customers.',

    // Separate projects, separate figures. Items, not customers.
    worldcupSales: 'The project sold around 70–80 items.',
    hebezSales: 'Our first batch of seven shirts sold out.'
  };

  var LINKS = {
    asiv: 'https://www.asiv.ai.kr/',
    worldcup: 'https://worldcup-project-one.vercel.app/'
  };

  window.SITE = {
    name: 'YoungSeok Lee',
    facts: FACTS,

    projects: [
      {
        id: 'asiv',
        name: 'ASIV',
        featured: true,
        logo: { src: 'assets/brand/asiv-logo-horizontal.webp', width: 588, height: 129 },
        role: 'Sole Founder & Builder',
        period: '2026–Present',
        lede: 'AI workers for the work between ERP screens.',
        media: [
          {
            src: 'assets/work/asiv-review-step.webp',
            width: 972,
            height: 609,
            // phones show just the review card from the same screenshot
            small: { src: 'assets/work/asiv-review-card.webp', width: 752, height: 434 },
            alt: 'ASIV console showing a proposed delivery-date change to purchase order 4500012345, line 20, in SAP S/4HANA, previewed with an "Approve these values and run" button and the note "Waiting for your approval — nothing has been changed." Sample data.',
            caption: 'ASIV console — sample workflow.',
            zoom: true
          }
        ],
        // Finished results go in done. Goals and open conversations go in
        // open, so they are never shown as completed.
        status: {
          done: { label: 'Evidence', items: [FACTS.interviews, FACTS.waitlist] },
          open: { label: 'In progress', items: [FACTS.launch, FACTS.businessTalks] },
          asOf: true
        },
        story: [
          { label: 'What I built', text: "I built ASIV's first products to check ERP records and approval documents. I am now developing AI workers that gather context, ask for missing information, execute authorized actions, and verify the result." },
          { label: 'My contribution', text: "I lead product direction, implementation, testing, and customer discovery. My father, an ERP consultant with more than 17 years of experience, is ASIV's ERP Domain Advisor." },
          { label: 'Challenge and decision', text: 'An early feature compared two Excel files to identify migration problems, but the first version returned errors. I rebuilt it around an LLM and reworked the original engine into an ontology. Repeated questions and feedback from my father helped me extend the system.' },
          { label: 'What I learned', text: 'Finding a problem creates another job for the user. I want ASIV to carry more of that remaining work through, rather than stop at an alert.' }
        ],
        links: [
          { label: 'Visit ASIV', url: LINKS.asiv }
        ]
      },
      {
        id: 'worldcup',
        name: 'Worldcup Project',
        role: 'Builder',
        // period omitted: no confirmed date
        lede: 'An online clothing storefront inspired by Korean and Mexican football fans.',
        media: [
          {
            // captured from the public site (its English view), November 6, 2026
            src: 'assets/work/worldcup-storefront.webp',
            width: 1440,
            height: 900,
            small: { src: 'assets/work/worldcup-storefront-mobile.webp', width: 780, height: 960 },
            alt: 'Worldcup Project storefront homepage: "Pride you wear. Korea × Mexico." with View collection and How it works buttons.',
            link: LINKS.worldcup
          }
        ],
        status: {
          done: { label: 'Result', items: [FACTS.worldcupSales] }
        },
        story: [
          { label: 'What I built', text: 'I built an online clothing storefront inspired by the connection between Korean and Mexican football fans.' },
          { label: 'My contribution', text: 'I built the website and helped turn the idea into products people could buy.' },
          { label: 'Challenge and decision', text: 'The project required more than putting a website online: we had to decide what to offer and give people a reason to buy it.' },
          { label: 'What I learned', text: 'I experienced the full path from an idea to a storefront to someone paying for what we had made.' }
        ],
        links: [
          { label: 'Visit project', url: LINKS.worldcup }
        ]
      },
      {
        id: 'hebez',
        name: 'HeBeZ',
        compact: true, // text only: no image, no link
        role: 'Project Lead',
        period: 'During high school',
        lede: 'A student clothing project, from customer research to sales.',
        status: {
          done: { label: 'Result', items: [FACTS.hebezSales] }
        },
        story: [
          { label: 'What I built and did', text: 'I led HeBeZ, a school clothing project covering customer research, pricing, web development, production, and sales.' },
          { label: 'What I learned', text: 'I learned how decisions about the customer, product, website, and price had to work together before a small idea could become a sale.' }
        ]
      }
    ],

    about: {
      intro: "I'm YoungSeok Lee, the sole founder of ASIV. I build with AI development tools and learn by observing work, asking questions, and changing what I make. I postponed university for a year to build ASIV.",
      storyLabel: 'Read my story',
      // The approved long story, one string per paragraph, exactly as written.
      story: [
        'An old school diary reminded me how much I had wanted to spend time with my father. By then, studying US stocks had led me to AI. I began asking whether I could use it to save him time.',
        'My father has spent more than 17 years implementing ERP systems, the software companies use to manage purchasing, inventory, and finance. I had assumed his job was mostly installing software. Observing his work and conducting 97 interview sessions led me to the work between the screens: reconciling conflicting records, chasing missing information, and applying each company\'s rules.',
        "I began with file and scheduling tools and voice-input experiments. At 18, I built ASIV's first products to check ERP records and approval documents, using AI development tools. I am its sole founder and handle implementation, testing, and customer discovery. My father is ASIV's ERP Domain Advisor.",
        'In one feature, a user uploads two Excel files to a Migration section, and ASIV compares them to pinpoint the problems. The first version returned errors. Rather than patch it, I rebuilt the system with an LLM at its core and turned the original engine into an ontology it works from. I kept asking my father questions and used his feedback to add more functions.',
        "So far, nearly 200 people have joined ASIV's waitlist for its launch, which I am targeting for November 27. I am also in discussions with several potential business customers.",
        'Building and interviewing also changed what I wanted ASIV to do. Finding a problem creates another job for the user. Someone still has to investigate it, get approval, and confirm that the correction happened. So I decided to build ASIV around AI workers that carry those tasks through. I am now developing them to gather context, ask for missing information, execute authorized actions, and verify the result.',
        'A consultant learns how a company operates by resolving its exceptions. I want ASIV to retain verified rules and procedures from those resolutions, so the next task does not start from scratch. We plan to start with individual ERP practitioners and expand into their teams and, eventually, the factories their systems help operate.',
        'Before ASIV, I led HeBeZ, a school clothing project spanning customer research, web development, production, and sales. I also built Worldcup Project, an online clothing storefront inspired by the connection between Korean and Mexican football fans. That project sold around 70–80 items. These projects let me experience the whole process: deciding what to offer, building a place to sell it, and getting people to pay for something we had made.',
        'In school, I followed the instructions for succeeding, yet I was unsure what I was succeeding at. I postponed university for a year to build ASIV. I want my technical understanding and judgment to keep up with what AI now enables me to make.',
        'At The Academy, I want peers who will use what I build, question my assumptions, and let me do the same for them. I used to treat friendships and conversations as distractions from learning. I want them to become part of how I learn.'
      ],
      team: [
        { name: 'YoungSeok Lee', role: 'Sole founder' },
        { name: "YoungSeok's father", role: 'ERP Domain Advisor', note: 'More than 17 years implementing ERP systems' }
      ]
    },

    recognition: {
      title: 'Education & Recognition',
      photo: {
        src: 'assets/recognition/certificates-medals-1000.webp',
        width: 1000,
        height: 750,
        large: { src: 'assets/recognition/certificates-medals-1536.webp', width: 1536, height: 1152 },
        alt: 'School certificates and folders arranged in a fan, with two HME mathematics medals.',
        caption: 'I received 79 awards across school and external competitions during middle and high school. Pictured here are selected school certificates and records, alongside HME mathematics medals from my earlier years.'
      },
      // Confirmed entries only, worded as approved, in this order.
      // meta is the quiet label above each title, shown as written:
      // [when, status] renders "when · status"; a single item renders alone.
      items: [
        {
          meta: ['2026', 'Selected & Completed'],
          title: 'AX Asan Local Creator Accelerator',
          description: 'Selected for and completed the accelerator operated by Asan City and BlueMoonDream. The program committed up to KRW 10 million in non-dilutive support for ASIV, helping me turn ERP field research into a working product.'
        },
        {
          meta: ['October 2026', 'Selected & Participated'],
          title: 'Ambition for Korea × Anthropic',
          description: 'Selected as one of 100 participants from about 1,000 applicants. Participated in the one-day AI hackathon in Seoul, organized by Bloom in collaboration with Anthropic.'
        },
        {
          meta: ['Filed', 'Three Applications'],
          title: 'Patent Applications',
          description: 'Filed three patent applications during ASIV’s development, alongside building the product, conducting customer interviews, and testing its behavior.'
        },
        {
          meta: ['2023–2026', 'Graduated'],
          title: 'Chungnam Foreign Language High School (CFLHS)',
          description: 'Graduated from the Chinese language track. I postponed university for a year to build ASIV, teaching myself software development through the problems I encountered while building it.'
        },
        {
          meta: ['2020–2022', 'Selected & Completed'],
          title: 'Asan Office of Education — Gifted Education',
          description: 'Selected for advanced middle-school programs in humanities (2020–2021) and mathematics (2021–2022), completing both. My mathematics studies included calculus while I was still in middle school.'
        },
        {
          // no year on this entry
          meta: ['Awarded'],
          title: 'HME Mathematics Assessment',
          description: 'Received Top Excellence, Excellence, and Encouragement awards in the HME Mathematics Assessment.'
        }
      ]
    },

    contact: {
      title: "Let's talk.",
      line: "If you're building something, working through an ERP problem, or want to compare notes, I'd like to hear from you.",
      email: 'LeeYoungSeok@asiv.ai.kr',
      links: [
        { label: 'GitHub', url: 'https://github.com/HeBeZ7' },
        { label: 'LinkedIn', url: 'https://www.linkedin.com/in/young-seok-lee-a3443541a/' },
        { label: 'X', url: 'https://x.com/TbYoutuber' }
      ],
      location: 'Asan, South Korea'
    }
  };
})();
