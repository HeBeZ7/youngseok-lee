/*
 * Site content — the only file you need to edit to update the page.
 *
 *  - todo('…') marks material that has not been provided yet. It renders as a
 *    visible "교체 필요" box, and the browser console lists every open item.
 *    Replace todo('…') with the final text (a string) when it arrives.
 *  - FACTS holds claims whose wording is fixed. Keep the sentences exactly as
 *    agreed and update numbers/dates here only; every section reads from it.
 *  - Links with an empty url render as "pending" and are not clickable.
 *  - In paragraphs, **text** becomes bold.
 */
(function () {
  'use strict';

  function todo(hint) { return { todo: hint }; }

  var FACTS = {
    // Date the figures below were last checked. Shown next to them.
    asOf: '2026-11-06',

    interviews: '97 interview sessions.',
    waitlist: 'Nearly 200 people on the waitlist.',
    launch: 'Targeting a November 27, 2026 launch.',
    businessTalks: 'Discussions with several potential business customers.',

    worldcupSales: 'Worldcup Project sold around 70–80 items.'
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
        lede: todo('ASIV를 한두 문장으로: 무엇을, 누구를 위해 만들었는지'),
        period: todo('기간 (예: 2025 – present)'),
        media: [
          {
            src: 'assets/work/asiv-review-step.webp',
            width: 972,
            height: 609,
            // phones show just the review card from the same screenshot
            small: { src: 'assets/work/asiv-review-card.webp', width: 752, height: 434 },
            alt: 'ASIV screen showing a proposed delivery-date change to purchase order 4500012345, line 20, in SAP S/4HANA. The change is a preview with an "Approve these values and run" button and the note "Waiting for your approval — nothing has been changed." Example data.',
            caption: 'The review step. A proposed change to an SAP S/4HANA purchase order is shown as a preview, and nothing in the ERP changes until the values are approved. Example data.'
          }
        ],
        // Finished results go in soFar. Goals and open conversations go in
        // inProgress, so they are never shown as completed.
        status: {
          soFar: [FACTS.interviews, FACTS.waitlist],
          inProgress: [FACTS.launch, FACTS.businessTalks]
        },
        story: {
          built: todo('무엇을 만들었는가 — 제품이 실제로 하는 일'),
          role: todo('내가 직접 맡은 일 — 설계·개발·인터뷰·영업 등 본인이 한 부분'),
          decisions: todo('부딪힌 문제와 바꾼 결정 — 무엇이 막혔고 어떤 선택을 바꿨는지'),
          outcome: todo('결과와 배운 점')
        },
        links: [
          { label: 'Product', url: '' },
          { label: 'Code', url: '' },
          { label: 'Demo', url: '' }
        ]
      },
      {
        id: 'worldcup',
        name: 'Worldcup Project',
        lede: todo('Worldcup Project를 한두 문장으로'),
        period: todo('기간'),
        media: [],
        mediaHint: 'Worldcup Project 실제 사진·화면',
        status: {
          soFar: [FACTS.worldcupSales],
          inProgress: []
        },
        story: {
          built: todo('무엇을 만들었는가'),
          role: todo('내가 직접 맡은 일'),
          decisions: todo('부딪힌 문제와 바꾼 결정'),
          outcome: todo('결과와 배운 점')
        },
        links: [
          { label: 'Product', url: '' },
          { label: 'Code', url: '' },
          { label: 'Demo', url: '' }
        ]
      },
      {
        id: 'hebez',
        name: 'HeBeZ',
        lede: todo('HeBeZ를 한두 문장으로'),
        period: todo('기간'),
        media: [],
        mediaHint: 'HeBeZ 실제 화면',
        status: { soFar: [], inProgress: [] },
        story: {
          built: todo('무엇을 만들었는가'),
          role: todo('내가 직접 맡은 일'),
          decisions: todo('부딪힌 문제와 바꾼 결정'),
          outcome: todo('결과와 배운 점')
        },
        links: [
          { label: 'Product', url: '' },
          { label: 'Code', url: '' },
          { label: 'Demo', url: '' }
        ]
      }
    ],

    about: {
      // Paste the final self-introduction here, one string per paragraph,
      // exactly as written. Leave the array empty until it is final.
      paragraphs: [],
      pendingHint: '최종 자기소개 글 — 별도 제공 예정. 문장 그대로 단락별로 붙여넣기',
      team: [
        { name: 'YoungSeok Lee', role: 'Solo founder' },
        { name: 'YoungSeok’s father', role: 'ERP Domain Advisor' }
      ]
    },

    recognition: {
      // Add confirmed entries only. status must be one of:
      //   'participated' | 'selected' | 'awarded' | 'support-agreement'
      // Example:
      //   { year: '2026', title: 'Program name', org: 'Organiser', status: 'selected', note: '' }
      items: [],
      pendingHint: '확인된 활동·수상만 추가. 항목마다 실제 상태(참가 / 선정 / 수상 / 지원 약정)를 구분'
    },

    contact: {
      // Use only addresses you have confirmed. Email: 'mailto:name@example.com'
      links: [
        { label: 'GitHub', url: '' },
        { label: 'LinkedIn', url: '' },
        { label: 'X', url: '' },
        { label: 'Email', url: '' }
      ]
    }
  };
})();
